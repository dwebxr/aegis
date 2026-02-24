import type { ContentItem } from "@/lib/types/content";
import type { FilteredItem, FilterPipelineResult } from "./types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import { hasEnoughData } from "@/lib/preferences/engine";

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
const CONTENT_SERENDIPITY_QUALITY_THRESHOLD = 7.0;
const TOPIC_NOVELTY_THRESHOLD = 0.15;

/**
 * Content-based serendipity for non-WoT items (RSS/URL).
 * Surfaces high-quality content from unfamiliar topics or unknown authors.
 */
export function isContentSerendipity(
  item: ContentItem,
  profile: UserPreferenceProfile | undefined,
): boolean {
  if (item.scores.composite <= CONTENT_SERENDIPITY_QUALITY_THRESHOLD) return false;

  // Cold start: treat all high-quality items as serendipity
  if (!profile || !hasEnoughData(profile)) return true;

  // Topic novelty: average affinity for item's topics is below threshold
  const topics = item.topics;
  if (topics && topics.length > 0) {
    const affinities = topics.map(t => Math.abs(profile.topicAffinities[t] ?? 0));
    const avgAffinity = affinities.reduce((a, b) => a + b, 0) / affinities.length;
    if (avgAffinity < TOPIC_NOVELTY_THRESHOLD) return true;
  }

  // Author novelty: author not yet in authorTrust
  if (item.author && !profile.authorTrust[item.author]) return true;

  return false;
}

export function classifyDiscovery(fi: FilteredItem): DiscoveryType {
  // WoT-based: outside follow graph
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
      if (!fi.wotScore) {
        return `New perspective: ${topics} from ${author} — quality ${score}/10`;
      }
      return `Emerging topic: ${topics} — ${author} scored ${score}/10 with low network overlap`;
  }
}

export function detectSerendipity(
  result: FilterPipelineResult,
): SerendipityItem[] {
  const candidates = result.items.filter(fi => fi.isWoTSerendipity || fi.isContentSerendipity);

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
