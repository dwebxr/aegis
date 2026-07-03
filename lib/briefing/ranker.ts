import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile, ActivityHistogram } from "@/lib/preferences/types";
import type { BriefingState, BriefingItem, BriefingClassification } from "./types";
import { normalizeUrl } from "@/contexts/content/dedup";

const PRIORITY_COUNT = 5;
const RECENCY_HALF_LIFE_HOURS = 7;
const HALF_LIFE_CATCHUP = 24;       // Catchup mode: 24-hour half-life
const GAP_THRESHOLD_HOURS = 4;      // 4+ hour gap triggers catchup mode
const MIN_HISTOGRAM_EVENTS = 10;    // Minimum data before adapting

export function adaptiveHalfLife(
  histogram: ActivityHistogram | undefined,
  now: number,
): number {
  if (!histogram || histogram.totalEvents < MIN_HISTOGRAM_EVENTS) {
    return RECENCY_HALF_LIFE_HOURS;
  }

  const hoursSinceLastActivity = (now - histogram.lastActivityAt) / 3600000;

  if (hoursSinceLastActivity >= GAP_THRESHOLD_HOURS) {
    const gapFactor = Math.min(hoursSinceLastActivity / 8, 1);
    return RECENCY_HALF_LIFE_HOURS + (HALF_LIFE_CATCHUP - RECENCY_HALF_LIFE_HOURS) * gapFactor;
  }

  return RECENCY_HALF_LIFE_HOURS;
}
const FAMILIAR_THRESHOLD = 0.5;
const NOVEL_THRESHOLD = 0.15;
const RECENT_TOPIC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function classifyItem(item: ContentItem, prefs: UserPreferenceProfile): BriefingClassification {
  const topics = item.topics;
  if (!topics || topics.length === 0) return "novel";
  const avgAffinity = topics.reduce((sum, t) =>
    sum + Math.abs(prefs.topicAffinities[t] ?? 0), 0) / topics.length;
  if (avgAffinity > FAMILIAR_THRESHOLD) return "familiar";
  if (avgAffinity < NOVEL_THRESHOLD) return "novel";
  return "mixed";
}

// Bound how many of an item's topics contribute to the personalization bonus, so a
// broadly/imprecisely tagged item can't outrank a focused one on tag COUNT alone.
const MAX_SCORED_TOPICS = 3;

function briefingScore(item: ContentItem, prefs: UserPreferenceProfile, now?: number): number {
  const baseScore = item.scores.composite;
  const currentTime = now ?? Date.now();
  const topics = item.topics ?? [];

  // Penalties (disliked topics, negative affinity) always count IN FULL; only the
  // positive bonus is capped to the top-K. So broad/imprecise tagging can neither bury
  // a negative preference nor inflate the score on tag COUNT alone.
  const affinities = topics.map(t => prefs.topicAffinities[t] || 0);
  const topicRelevance =
    affinities.filter(a => a < 0).reduce((sum, a) => sum + a, 0) +
    affinities.filter(a => a > 0).sort((a, b) => b - a).slice(0, MAX_SCORED_TOPICS)
      .reduce((sum, a) => sum + a, 0);

  const authorBoost = prefs.authorTrust[item.author]?.trust || 0;

  const recentTopicCount = topics.filter(t =>
    prefs.recentTopics.some(rt => rt.topic === t && currentTime - rt.timestamp < RECENT_TOPIC_WINDOW_MS),
  ).length;
  const recentBonus = Math.min(recentTopicCount, MAX_SCORED_TOPICS) * 0.3;

  const ageHours = (currentTime - item.createdAt) / 3600000;
  const halfLife = adaptiveHalfLife(prefs.activityHistogram, currentTime);
  const decayRate = Math.LN2 / halfLife;
  const recencyFactor = Math.exp(-decayRate * ageHours);

  return (baseScore + topicRelevance * 2 + authorBoost + recentBonus) * recencyFactor;
}

function serendipityScore(item: ContentItem, prefs: UserPreferenceProfile): number {
  // High V_signal + low C_context = content outside user's bubble but still valuable
  const vSignal = item.vSignal ?? item.scores.composite;

  const topicNovelty = item.topics?.reduce((sum, t) => {
    const affinity = prefs.topicAffinities[t] ?? 0;
    return sum + Math.max(0, 0.5 - affinity);
  }, 0) || 0;

  // noveltyBonus only when cContext was actually scored by AI — a missing
  // cContext means the scoring engine didn't produce personalization data,
  // so we can't infer novelty and default to 0 instead of a fake midpoint.
  const noveltyBonus = item.cContext != null ? Math.max(0, 10 - item.cContext) : 0;
  return vSignal * 0.5 + noveltyBonus * 0.3 + topicNovelty * 0.2;
}

function deduplicateBySource(items: ContentItem[]): ContentItem[] {
  // Sort by composite DESC so the best item claims each URL/text key first, then
  // greedily skip any item whose normalized URL OR exact text is already claimed.
  // (The prior index-mutation approach left a text-duplicate in the result when it
  // also matched a *different* item by URL — only one of the two matches was ever
  // evicted, and the stale index entries could mis-compare later items.)
  // generateBriefing re-ranks the result, so the composite-DESC order here is fine.
  const seenUrls = new Set<string>();
  const seenTexts = new Set<string>();
  const kept: ContentItem[] = [];
  for (const item of [...items].sort((a, b) => b.scores.composite - a.scores.composite)) {
    const normUrl = item.sourceUrl ? normalizeUrl(item.sourceUrl) : null;
    if ((normUrl && seenUrls.has(normUrl)) || seenTexts.has(item.text)) continue;
    if (normUrl) seenUrls.add(normUrl);
    seenTexts.add(item.text);
    kept.push(item);
  }
  return kept;
}

export function generateBriefing(
  content: ContentItem[],
  prefs: UserPreferenceProfile,
  now?: number,
): BriefingState {
  const threshold = prefs.calibration.qualityThreshold;
  const qualityItems = content.filter(c =>
    c.verdict === "quality" && !c.flagged && c.scores.composite >= threshold,
  );

  // Deduplicate by sourceUrl — keep the highest-composite item per URL
  const dedupedItems = deduplicateBySource(qualityItems);

  const scored: Array<{ item: ContentItem; score: number }> = dedupedItems.map(item => ({
    item,
    score: briefingScore(item, prefs, now),
  }));
  // Stable sort: tiebreaker by ID prevents ranking flicker when content array is reordered
  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

  const priorityItems = scored.slice(0, PRIORITY_COUNT);
  const priorityIds = new Set(priorityItems.map(s => s.item.id));

  const remainingQuality = scored.filter(s => !priorityIds.has(s.item.id));
  let serendipity: BriefingItem | null = null;

  if (remainingQuality.length > 0) {
    const serendipityCandidates = remainingQuality.map(s => ({
      item: s.item,
      score: serendipityScore(s.item, prefs),
    }));
    serendipityCandidates.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
    const best = serendipityCandidates[0];
    serendipity = {
      item: best.item,
      briefingScore: best.score,
      isSerendipity: true,
      classification: "novel",
    };
  }

  if (serendipity) priorityIds.add(serendipity.item.id);

  const filteredOut = content.filter(c => !priorityIds.has(c.id));

  return {
    priority: priorityItems.map(s => ({
      item: s.item,
      briefingScore: s.score,
      isSerendipity: false,
      classification: classifyItem(s.item, prefs),
    })),
    serendipity,
    filteredOut,
    totalItems: content.length,
    generatedAt: Date.now(),
  };
}
