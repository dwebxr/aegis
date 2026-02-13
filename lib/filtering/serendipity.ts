import type { ContentItem } from "@/lib/types/content";
import type { FilteredItem, FilterPipelineResult } from "./types";

export type DiscoveryType = "out_of_network" | "cross_language" | "emerging_topic";

export interface SerendipityItem {
  item: ContentItem;
  wotScore: number;
  qualityComposite: number;
  discoveryType: DiscoveryType;
  reason: string;
}

const MAX_DISCOVERIES = 5;
const NON_ASCII_RE = /[^\x00-\x7F]/g;

export function classifyDiscovery(fi: FilteredItem): DiscoveryType {
  if (fi.wotScore && (!fi.wotScore.isInGraph || fi.wotScore.hopDistance >= 3)) {
    return "out_of_network";
  }

  const { text } = fi.item;
  const nonAsciiRatio = (text.match(NON_ASCII_RE) || []).length / Math.max(text.length, 1);
  if (nonAsciiRatio > 0.3) return "cross_language";

  return "emerging_topic";
}

export function generateDiscoveryReason(
  fi: FilteredItem,
  discoveryType: DiscoveryType,
): string {
  const { author } = fi.item;
  const score = fi.item.scores.composite.toFixed(1);
  const topics = fi.item.topics?.slice(0, 2).join(", ") || "general";

  switch (discoveryType) {
    case "out_of_network":
      return `${author} is outside your follow network but scored ${score}/10 on ${topics}`;
    case "cross_language":
      return `Cross-language signal from ${author} — quality ${score}/10 on ${topics}`;
    case "emerging_topic":
      return `Emerging topic: ${topics} — ${author} scored ${score}/10 with low network overlap`;
  }
}

export function detectSerendipity(
  result: FilterPipelineResult,
): SerendipityItem[] {
  const candidates = result.items.filter(fi => fi.isWoTSerendipity);

  candidates.sort((a, b) => b.item.scores.composite - a.item.scores.composite);

  return candidates.slice(0, MAX_DISCOVERIES).map(fi => {
    const discoveryType = classifyDiscovery(fi);
    return {
      item: fi.item,
      wotScore: fi.wotScore?.trustScore ?? 0,
      qualityComposite: fi.item.scores.composite,
      discoveryType,
      reason: generateDiscoveryReason(fi, discoveryType),
    };
  });
}
