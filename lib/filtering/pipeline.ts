import { v4 as uuidv4 } from "uuid";
import { type ContentItem, scoredItemFields } from "@/lib/types/content";
import type { WoTGraph } from "@/lib/wot/types";
import type { FilterConfig, FilteredItem, FilterPipelineResult, FilterPipelineStats } from "./types";
import { calculateWoTScore, calculateWeightedScore, isWoTSerendipity } from "@/lib/wot/scorer";
import { isContentSerendipity } from "./serendipity";
import { findMatchingBurnRule } from "./customRules";
import { heuristicScores } from "@/lib/ingestion/quickFilter";
import type { RawItem } from "@/lib/ingestion/fetchers";

// Anthropic Claude Sonnet via /api/analyze — ~400 input tokens + ~100 output
// Based on Sonnet 4 pricing: $3/MTok input + $15/MTok output
const ESTIMATED_AI_COST_PER_CALL = 0.003;
const PAID_ENGINES = new Set(["claude-byok", "claude-ic", "claude-server"]);

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
    customRulesBurned: 0,
    burnedByRule: [],
    burnedByThreshold: [],
  };

  const items: FilteredItem[] = [];
  let paidCount = 0;
  const customRules = config.customRules ?? [];

  for (const item of content) {
    const isAI = item.scoredByAI ?? !item.reason?.startsWith("Heuristic");
    if (isAI) stats.aiScoredCount++;
    if (item.scoringEngine ? PAID_ENGINES.has(item.scoringEngine) : isAI) paidCount++;

    if (customRules.length > 0) {
      const matched = findMatchingBurnRule(item, customRules);
      if (matched) {
        stats.customRulesBurned++;
        stats.burnedByRule.push({
          itemId: item.id,
          ruleId: matched.id,
          field: matched.field,
          pattern: matched.pattern,
        });
        continue;
      }
    }
    if (item.scores.composite < config.qualityThreshold) {
      stats.burnedByThreshold.push(item.id);
      continue;
    }

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

    const contentSerendipity = !wotScore
      ? isContentSerendipity(item, config.profile)
      : false;

    if (serendipity || contentSerendipity) stats.serendipityCount++;

    items.push({ item, wotScore, weightedComposite, isWoTSerendipity: serendipity, isContentSerendipity: contentSerendipity });
  }

  stats.estimatedAPICost = paidCount * ESTIMATED_AI_COST_PER_CALL;
  items.sort((a, b) => b.weightedComposite - a.weightedComposite);

  return { items, stats };
}

export function scoreItemWithHeuristics(
  raw: RawItem,
  sourceType: "rss" | "url" | "nostr" | "farcaster",
  platform?: import("@/lib/types/sources").SourcePlatform,
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
    ...scoredItemFields({ ...h, scoringEngine: "heuristic" }),
    platform,
  };
}
