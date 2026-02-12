import { HttpAgent, Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { idlFactory } from "@/lib/ic/declarations/idlFactory";
import type { _SERVICE } from "@/lib/ic/declarations/aegis_backend.did";
import type { D2ABriefingResponse, D2ABriefingItem } from "./types";

const CANISTER_ID = (process.env.NEXT_PUBLIC_CANISTER_ID || "rluf3-eiaaa-aaaam-qgjuq-cai").trim();
const IC_HOST = (process.env.NEXT_PUBLIC_IC_HOST || "https://icp-api.io").trim();

export async function getLatestBriefing(principalText?: string): Promise<D2ABriefingResponse | null> {
  const agent = await HttpAgent.create({ host: IC_HOST });
  const actor = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: CANISTER_ID });

  // If a principal is provided, fetch that user's briefing snapshot
  if (principalText) {
    const p = Principal.fromText(principalText);
    const result = await actor.getLatestBriefing(p);
    if (result.length === 0) return null;
    try {
      return JSON.parse(result[0]) as D2ABriefingResponse;
    } catch {
      return null;
    }
  }

  // Without a principal, build a sample briefing from recent quality evaluations
  return buildPublicBriefing(actor);
}

async function buildPublicBriefing(actor: _SERVICE): Promise<D2ABriefingResponse | null> {
  // Use the canister's own principal to get recent global evaluations
  // We'll query the canister for recent high-quality evaluations
  const canisterPrincipal = Principal.fromText(CANISTER_ID);
  const evals = await actor.getUserEvaluations(canisterPrincipal, BigInt(0), BigInt(10));

  // If no canister-owned evaluations, return null (MVP: user-specific briefings only)
  if (!evals || evals.length === 0) return null;

  const items: D2ABriefingItem[] = evals
    .filter(e => "quality" in e.verdict)
    .slice(0, 5)
    .map(e => ({
      title: e.text.slice(0, 80),
      content: e.text,
      source: Object.keys(e.source)[0],
      sourceUrl: (e.sourceUrl.length > 0 ? e.sourceUrl[0] : "") ?? "",
      scores: {
        originality: e.scores.originality,
        insight: e.scores.insight,
        credibility: e.scores.credibility,
        composite: e.scores.compositeScore,
      },
      verdict: "quality" as const,
      reason: e.reason,
      topics: [],
      briefingScore: e.scores.compositeScore,
    }));

  if (items.length === 0) return null;

  const totalEvaluated = evals.length;
  const totalBurned = evals.filter(e => "slop" in e.verdict).length;

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    source: "aegis",
    sourceUrl: "https://aegis.dwebxr.xyz",
    summary: {
      totalEvaluated,
      totalBurned,
      qualityRate: totalEvaluated > 0 ? (totalEvaluated - totalBurned) / totalEvaluated : 0,
    },
    items,
    serendipityPick: null,
    meta: {
      scoringModel: "aegis-vcl-v1",
      nostrPubkey: null,
      topics: [],
    },
  };
}
