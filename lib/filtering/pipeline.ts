import { v4 as uuidv4 } from "uuid";
import type { ContentItem } from "@/lib/types/content";
import type { WoTGraph } from "@/lib/wot/types";
import type { FilterConfig, FilteredItem, FilterPipelineResult, FilterPipelineStats } from "./types";
import { calculateWoTScore, calculateWeightedScore, isWoTSerendipity } from "@/lib/wot/scorer";
import { isContentSerendipity } from "./serendipity";
import { heuristicScores } from "@/lib/ingestion/quickFilter";

// Anthropic Claude Sonnet via /api/analyze — ~400 input tokens + ~100 output
// Based on Sonnet 4 pricing: $3/MTok input + $15/MTok output
const ESTIMATED_AI_COST_PER_CALL = 0.003;

export function runFilterPipeline(
  content: ContentItem[],
  wotGraph: WoTGraph | null,
  config: FilterConfig,
): FilterPipelineResult {
  const stats: FilterPipelineStats = {
    totalInput: content.length,
    wotScoredCount: 0,
    aiScoredCount: 0,
    serendipityCount: 0,
    estimatedAPICost: 0,
    mode: config.mode,
  };

  const items: FilteredItem[] = [];

  for (const item of content) {
    if (item.scores.composite < config.qualityThreshold) continue;

    let wotScore = null;
    if (config.wotEnabled && wotGraph && item.nostrPubkey) {
      wotScore = calculateWoTScore(item.nostrPubkey, wotGraph);
      stats.wotScoredCount++;
    }

    const trustValue = wotScore?.trustScore ?? 0.5;
    const weightedComposite = calculateWeightedScore(item.scores.composite, trustValue);
    const serendipity = wotScore
      ? isWoTSerendipity(wotScore.trustScore, item.scores.composite)
      : false;

    // Content-based serendipity for non-WoT items (RSS/URL)
    const contentSerendipity = !wotScore
      ? isContentSerendipity(item, config.profile)
      : false;

    if (serendipity || contentSerendipity) stats.serendipityCount++;

    items.push({ item, wotScore, weightedComposite, isWoTSerendipity: serendipity, isContentSerendipity: contentSerendipity });
  }

  // Second pass over all content (incl. below-threshold): count AI-scored items and paid tiers for cost estimation
  let aiScoredCount = 0;
  let paidCount = 0;
  for (const c of content) {
    const legacyAI = c.scoredByAI === true || (c.scoredByAI == null && !c.reason?.startsWith("Heuristic"));
    if (legacyAI) aiScoredCount++;
    if (c.scoringEngine) {
      if (c.scoringEngine === "claude-byok" || c.scoringEngine === "claude-ic" || c.scoringEngine === "claude-server") paidCount++;
    } else if (legacyAI) {
      paidCount++;
    }
  }
  stats.aiScoredCount = aiScoredCount;
  stats.estimatedAPICost = paidCount * ESTIMATED_AI_COST_PER_CALL;

  items.sort((a, b) => b.weightedComposite - a.weightedComposite);

  return { items, stats };
}

export function scoreItemWithHeuristics(
  raw: { text: string; author: string; avatar?: string; sourceUrl?: string; imageUrl?: string; nostrPubkey?: string },
  sourceType: "rss" | "url" | "nostr",
): ContentItem {
  const h = heuristicScores(raw.text);

  return {
    id: uuidv4(),
    owner: "",
    author: raw.author,
    avatar: raw.avatar || (sourceType === "nostr" ? "\uD83D\uDD2E" : "\uD83D\uDCE1"),
    text: raw.text.slice(0, 300),
    source: sourceType,
    sourceUrl: raw.sourceUrl,
    imageUrl: raw.imageUrl,
    nostrPubkey: raw.nostrPubkey,
    scores: {
      originality: h.originality,
      insight: h.insight,
      credibility: h.credibility,
      composite: h.composite,
    },
    verdict: h.verdict,
    reason: h.reason,
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    scoredByAI: false,
    scoringEngine: "heuristic",
  };
}
