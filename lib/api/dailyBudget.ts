/**
 * Per-day budget for expensive API calls (e.g. Anthropic).
 *
 * When Vercel KV (Upstash Redis) is configured via KV_REST_API_URL,
 * the counter is shared across all serverless instances using atomic
 * Redis INCR with date-based key partitioning and 24h TTL.
 *
 * Without KV, falls back to per-instance in-memory tracking (same as
 * before — resets on cold start, each instance gets its own budget).
 */

import * as Sentry from "@sentry/nextjs";
import { dailyBudgetKV, scoreBudgetKV } from "./kv/namespace";

const _parsed = parseInt((process.env.ANTHROPIC_DAILY_BUDGET || "500").trim(), 10);
const DAILY_BUDGET = Number.isNaN(_parsed) ? 500 : _parsed;
const _parsedScore = parseInt((process.env.SCORE_DAILY_BUDGET || "300").trim(), 10);
const SCORE_DAILY_BUDGET = Number.isNaN(_parsedScore) ? 300 : _parsedScore;

// In-memory fallback (per-instance)
let memCalls = 0;
let memResetAt = Date.now() + 86_400_000;
let memScoreCalls = 0;
let memScoreDate = new Date().toISOString().slice(0, 10);

function dailyKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function reserveScoreInMemory(): boolean {
  const today = dailyKey();
  if (today !== memScoreDate) {
    memScoreCalls = 0;
    memScoreDate = today;
  }
  if (memScoreCalls >= SCORE_DAILY_BUDGET) return false;
  memScoreCalls++;
  return true;
}

function canUseMemoryScoreBudget(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

function secondsUntilNextUtcDay(): number {
  const now = new Date();
  const nextUtcDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((nextUtcDay - now.getTime()) / 1000));
}

export async function withinDailyBudget(): Promise<boolean> {
  const storedCount = await dailyBudgetKV.get<number>(dailyKey());
  if (storedCount !== undefined) {
    return (storedCount ?? 0) < DAILY_BUDGET;
  }
  const now = Date.now();
  if (now >= memResetAt) {
    memCalls = 0;
    memResetAt = now + 86_400_000;
  }
  return memCalls < DAILY_BUDGET;
}

export async function recordApiCall(): Promise<void> {
  const count = await dailyBudgetKV.incr(dailyKey(), { ex: 86_400 });
  if (count !== undefined) {
    const threshold = Math.floor(DAILY_BUDGET * 0.1);
    if (threshold > 0 && count === DAILY_BUDGET - threshold) {
      console.warn(`[dailyBudget] 90% consumed: ${count}/${DAILY_BUDGET} calls used`);
    }
    return;
  }
  memCalls++;
  const threshold = Math.floor(DAILY_BUDGET * 0.1);
  if (threshold > 0 && memCalls === DAILY_BUDGET - threshold) {
    console.warn(`[dailyBudget] 90% consumed: ${memCalls}/${DAILY_BUDGET} calls used`);
  }
}

export async function _resetDailyBudget(): Promise<void> {
  await dailyBudgetKV.set(dailyKey(), undefined);
  memCalls = 0;
  memResetAt = Date.now() + 86_400_000;
  memScoreCalls = 0;
  memScoreDate = dailyKey();
}

export async function tryReserveScoreBudget(): Promise<boolean> {
  const key = dailyKey();
  const initialized = await scoreBudgetKV.set(key, 0, { nx: true, ex: 86_400 });
  if (initialized === undefined) {
    if (canUseMemoryScoreBudget()) return reserveScoreInMemory();
    throw new Error("Score budget requires KV in production");
  }

  const count = await scoreBudgetKV.incr(key);
  if (count === undefined) throw new Error("Score budget KV became unavailable");
  if (count <= SCORE_DAILY_BUDGET) return true;

  try {
    const restored = await scoreBudgetKV.decr(key);
    if (restored === undefined) throw new Error("Score budget KV became unavailable");
  } catch (err) {
    Sentry.captureException(err, {
      tags: { module: "dailyBudget", failure: "score-budget-decr" },
    });
  }
  return false;
}

export async function getScoreBudgetRetryAfter(): Promise<number> {
  const untilNextUtcDay = secondsUntilNextUtcDay();
  const ttl = await scoreBudgetKV.ttl(dailyKey());
  if (ttl === undefined || ttl <= 0) return untilNextUtcDay;
  return Math.min(ttl, untilNextUtcDay);
}
