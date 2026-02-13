import type { WoTGraph, WoTScore } from "./types";

export function calculateWoTScore(
  pubkey: string,
  graph: WoTGraph,
): WoTScore {
  const node = graph.nodes.get(pubkey);

  if (!node) {
    return { pubkey, trustScore: 0, hopDistance: Infinity, mutualFollows: 0, isInGraph: false };
  }

  // User themselves (hop 0) gets trust 1.0
  if (node.hopDistance === 0) {
    return { pubkey, trustScore: 1.0, hopDistance: 0, mutualFollows: node.mutualFollows, isInGraph: true };
  }

  // Find max mutual follows across all nodes for normalization
  let maxMutual = 0;
  graph.nodes.forEach((n) => {
    if (n.mutualFollows > maxMutual) maxMutual = n.mutualFollows;
  });

  // Trust formula: 60% hop proximity + 30% social proof + 10% base presence
  // Hop proximity (0.6): closest connections matter most — inverse distance decay
  // Social proof (0.3): mutual follows indicate network-verified trust
  // Base presence (0.1): being in the graph at all provides a minimum signal
  const hopComponent = (1 / node.hopDistance) * 0.6;
  const mutualComponent = maxMutual > 0 ? (node.mutualFollows / maxMutual) * 0.3 : 0;
  const baseComponent = 0.1;
  const trustScore = Math.min(1, hopComponent + mutualComponent + baseComponent);

  return {
    pubkey,
    trustScore,
    hopDistance: node.hopDistance,
    mutualFollows: node.mutualFollows,
    isInGraph: true,
  };
}

export function calculateWoTScores(
  pubkeys: string[],
  graph: WoTGraph,
): Map<string, WoTScore> {
  const results = new Map<string, WoTScore>();
  for (const pk of pubkeys) {
    results.set(pk, calculateWoTScore(pk, graph));
  }
  return results;
}

export function calculateWeightedScore(
  rawComposite: number,
  trustScore: number,
): number {
  return rawComposite * (0.5 + trustScore * 0.5);
}

// Serendipity: low trust (< 0.3 ≈ hop ≥ 3 with no mutual follows) + high quality (> 7/10)
// This surfaces content from outside the user's trust bubble that passes quality checks.
// Thresholds chosen so that: hop 3 w/ 0 mutuals → trust ≈ 0.3 (boundary),
// and 7.0 composite is the 70th percentile quality bar.
export function isWoTSerendipity(
  trustScore: number,
  qualityComposite: number,
): boolean {
  return trustScore < 0.3 && qualityComposite > 7.0;
}
