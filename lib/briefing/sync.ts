import type { ActorSubclass } from "@dfinity/agent";
import type { _SERVICE } from "@/lib/ic/declarations/aegis_backend.did";
import type { BriefingState } from "./types";
import type { D2ABriefingResponse, D2ABriefingItem } from "@/lib/d2a/types";

function toBriefingItem(bi: BriefingState["priority"][0]): D2ABriefingItem {
  const item = bi.item;
  return {
    title: item.text.slice(0, 80),
    content: item.text,
    source: item.source,
    sourceUrl: item.sourceUrl || "",
    scores: {
      originality: item.scores.originality,
      insight: item.scores.insight,
      credibility: item.scores.credibility,
      composite: item.scores.composite,
      ...(item.vSignal !== undefined && { vSignal: item.vSignal }),
      ...(item.cContext !== undefined && { cContext: item.cContext }),
      ...(item.lSlop !== undefined && { lSlop: item.lSlop }),
    },
    verdict: item.verdict,
    reason: item.reason,
    topics: item.topics || [],
    briefingScore: bi.briefingScore,
  };
}

export function briefingToD2AResponse(
  state: BriefingState,
  nostrPubkey: string | null = null,
): D2ABriefingResponse {
  const items = state.priority.map(toBriefingItem);
  const serendipityPick = state.serendipity ? toBriefingItem(state.serendipity) : null;

  const totalBurned = state.filteredOut.filter(c => c.verdict === "slop").length;
  const allTopics = new Set<string>();
  state.priority.forEach(bi => bi.item.topics?.forEach(t => allTopics.add(t)));

  return {
    version: "1.0",
    generatedAt: new Date(state.generatedAt).toISOString(),
    source: "aegis",
    sourceUrl: "https://aegis.dwebxr.xyz",
    summary: {
      totalEvaluated: state.totalItems,
      totalBurned,
      qualityRate: state.totalItems > 0
        ? (state.totalItems - totalBurned) / state.totalItems
        : 0,
    },
    items,
    serendipityPick,
    meta: {
      scoringModel: "aegis-vcl-v1",
      nostrPubkey,
      topics: Array.from(allTopics),
    },
  };
}

export async function syncBriefingToCanister(
  actor: ActorSubclass<_SERVICE>,
  state: BriefingState,
  nostrPubkey: string | null = null,
): Promise<boolean> {
  try {
    const response = briefingToD2AResponse(state, nostrPubkey);
    const json = JSON.stringify(response);
    return await actor.saveLatestBriefing(json);
  } catch (e) {
    console.error("[briefing/sync] Failed to sync briefing to canister:", e);
    return false;
  }
}
