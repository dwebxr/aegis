import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "@/lib/ic/declarations/idlFactory";
import { getCanisterId, getHost } from "@/lib/ic/agent";
import type { _SERVICE } from "@/lib/ic/declarations/aegis_backend.did";
import type { D2ABriefingResponse, GlobalBriefingContributor, GlobalBriefingResponse } from "./types";
import { withTimeout } from "@/lib/utils/timeout";
import { nsToMs } from "@/lib/utils/icTime";

async function createActor(): Promise<_SERVICE> {
  const agent = await HttpAgent.create({ host: getHost() });
  return Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: getCanisterId() });
}

/** The on-chain briefingScore carries a recency-decay factor (exp(-λ·age),
 *  half-life 7–24h) frozen at publish time — weeks-old content collapses to
 *  ~1e-20, which preserves ordering but is useless for display or thresholds.
 *  Serve a briefing-relative score instead: top priority item = 1, others
 *  proportional. Applied at READ time so briefings already stored on-chain get
 *  the same semantics. serendipityPick is left untouched: it carries a
 *  serendipityScore (0–10-ish scale, no decay factor), not a briefingScore —
 *  scaling it against the decayed item max would explode it. */
function normalizeBriefingScores(parsed: D2ABriefingResponse): D2ABriefingResponse {
  const positive = parsed.items
    .map(i => i.briefingScore)
    .filter(s => typeof s === "number" && Number.isFinite(s) && s > 0);
  if (positive.length === 0) return parsed;
  const max = Math.max(...positive);
  // Floor keeps every RANKED item strictly positive: a fresh top item next to a
  // weeks-older one can push the ratio below the 4-decimal resolution, and a
  // consumer thresholding on `briefingScore > 0` must not lose an item that IS
  // in the ranking. Ties at the floor are fine — ordering below this scale was
  // already destroyed by the decay factor.
  const SCORE_FLOOR = 0.0001;
  const norm = (s: number) =>
    typeof s === "number" && Number.isFinite(s) && s > 0
      ? Math.max(SCORE_FLOOR, Math.round((s / max) * 10_000) / 10_000)
      : 0;
  return {
    ...parsed,
    items: parsed.items.map(i => ({ ...i, briefingScore: norm(i.briefingScore) })),
  };
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
    return normalizeBriefingScores(parsed as D2ABriefingResponse);
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
      const rawParsed = JSON.parse(briefingJson) as D2ABriefingResponse;
      if (
        typeof rawParsed !== "object" || rawParsed === null ||
        typeof rawParsed.summary?.totalEvaluated !== "number" ||
        !Array.isArray(rawParsed.items)
      ) {
        console.warn("[briefingProvider] Skipped malformed briefing from", principal.toText().slice(0, 12));
        continue;
      }
      // Same briefing-relative score semantics as the per-principal read.
      const parsed = normalizeBriefingScores(rawParsed);

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
        sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : "",
        topics: item.topics || [],
        briefingScore: item.briefingScore,
        verdict: item.verdict,
      }));

      contributors.push({
        principal: principal.toText(),
        generatedAt: typeof generatedAt === "bigint"
          ? new Date(nsToMs(generatedAt)).toISOString()
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
        ? nsToMs(generatedAtNs)
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
