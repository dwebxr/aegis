import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "@/lib/ic/declarations/idlFactory";
import { getCanisterId, getHost } from "@/lib/ic/agent";
import type { _SERVICE } from "@/lib/ic/declarations/aegis_backend.did";
import type { D2ABriefingResponse, GlobalBriefingContributor, GlobalBriefingResponse } from "./types";
import { withTimeout } from "@/lib/utils/timeout";

async function createActor(): Promise<_SERVICE> {
  const agent = await HttpAgent.create({ host: getHost() });
  return Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: getCanisterId() });
}

export async function getLatestBriefing(principalText?: string): Promise<D2ABriefingResponse | null> {
  if (!principalText) return null;

  const actor = await createActor();
  const p = Principal.fromText(principalText);
  const result = await withTimeout(actor.getLatestBriefing(p), 15_000, "getLatestBriefing");

  if (result.length === 0) return null;
  try {
    const parsed = JSON.parse(result[0]);
    if (
      typeof parsed !== "object" || parsed === null ||
      typeof parsed.generatedAt !== "string" ||
      typeof parsed.summary?.totalEvaluated !== "number" ||
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.meta?.topics)
    ) {
      console.warn("[briefingProvider] Briefing JSON has unexpected shape, ignoring");
      return null;
    }
    return parsed as D2ABriefingResponse;
  } catch (err) {
    console.warn("[briefingProvider] Failed to parse briefing JSON:", err);
    return null;
  }
}

const MAX_TOP_ITEMS = 3;

export async function getGlobalBriefingSummaries(
  offset = 0,
  limit = 5,
): Promise<GlobalBriefingResponse | null> {
  const actor = await createActor();

  const result = await withTimeout(actor.getGlobalBriefingSummaries(BigInt(offset), BigInt(limit)), 20_000, "getGlobalBriefingSummaries");

  if (result.items.length === 0 && Number(result.total) === 0) return null;

  const topicCounts = new Map<string, number>();
  let totalEvaluated = 0;
  let totalQuality = 0;
  const contributors: GlobalBriefingContributor[] = [];

  for (const [principal, briefingJson, generatedAt] of result.items) {
    try {
      const parsed = JSON.parse(briefingJson) as D2ABriefingResponse;
      if (
        typeof parsed !== "object" || parsed === null ||
        typeof parsed.summary?.totalEvaluated !== "number" ||
        !Array.isArray(parsed.items)
      ) {
        console.warn("[briefingProvider] Skipped malformed briefing from", principal.toText().slice(0, 12));
        continue;
      }

      totalEvaluated += parsed.summary.totalEvaluated;
      totalQuality += parsed.summary.totalEvaluated - (parsed.summary.totalBurned || 0);

      for (const item of parsed.items) {
        if (!item || typeof item !== "object") continue;
        for (const topic of item.topics || []) {
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
        }
      }
      if (parsed.meta?.topics) {
        for (const topic of parsed.meta.topics) {
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
        }
      }

      const topItems = parsed.items.slice(0, MAX_TOP_ITEMS).map((item) => ({
        title: item.title,
        topics: item.topics || [],
        briefingScore: item.briefingScore,
        verdict: item.verdict,
      }));

      contributors.push({
        principal: principal.toText(),
        generatedAt: typeof generatedAt === "bigint"
          ? new Date(Number(generatedAt / BigInt(1_000_000))).toISOString()
          : parsed.generatedAt,
        summary: parsed.summary,
        topItems,
      });
    } catch {
      console.warn(`[briefingProvider] Failed to parse global briefing for ${principal.toText()}`);
    }
  }

  const aggregatedTopics = Array.from(topicCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([topic]) => topic);

  const totalQualityRate = totalEvaluated > 0 ? totalQuality / totalEvaluated : 0;

  return {
    version: "1.0",
    type: "global",
    generatedAt: new Date().toISOString(),
    pagination: { offset, limit, total: Number(result.total), hasMore: offset + limit < Number(result.total) },
    contributors,
    aggregatedTopics,
    totalEvaluated,
    totalQualityRate: Math.round(totalQualityRate * 100) / 100,
  };
}

export interface RawBriefingEntry {
  briefing: D2ABriefingResponse;
  generatedAtMs: number;
}

export async function getRawGlobalBriefings(sinceMs: number): Promise<RawBriefingEntry[]> {
  const actor = await createActor();
  const result = await withTimeout(
    actor.getGlobalBriefingSummaries(BigInt(0), BigInt(100)),
    20_000,
    "getGlobalBriefingSummaries",
  );

  const entries: RawBriefingEntry[] = [];
  for (const [, json, generatedAtNs] of result.items) {
    try {
      const parsed = JSON.parse(json) as D2ABriefingResponse;
      if (!parsed || !Array.isArray(parsed.items)) continue;

      // Compute timestamp: prefer bigint nanosecond IC timestamp, fall back to parsed generatedAt
      const fromBigint = typeof generatedAtNs === "bigint"
        ? Number(generatedAtNs / BigInt(1_000_000))
        : 0;
      const generatedAtMs = fromBigint > 0
        ? fromBigint
        : new Date(parsed.generatedAt).getTime();

      if (generatedAtMs <= sinceMs) continue;

      entries.push({ briefing: parsed, generatedAtMs });
    } catch (err) {
      console.warn("[briefingProvider] Skipped malformed raw briefing:", err);
    }
  }
  return entries;
}
