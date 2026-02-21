/**
 * Pure computation functions extracted from DashboardTab.tsx.
 * Shared by the component (via useMemo) and unit tests.
 */
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { BriefingItem } from "@/lib/briefing/types";
import { generateBriefing } from "@/lib/briefing/ranker";

/** Content-level dedup key: same article may have different IDs/URLs across sources */
export function contentDedup(item: ContentItem): string {
  return item.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Apply verdict and source filters to content list */
export function applyDashboardFilters(
  content: ContentItem[],
  verdictFilter: "all" | "quality" | "slop" | "validated",
  sourceFilter: string,
): ContentItem[] {
  let items = content;
  if (verdictFilter === "validated") {
    items = items.filter(c => c.validated);
    items = [...items].sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0));
  } else if (verdictFilter !== "all") {
    items = items.filter(c => c.verdict === verdictFilter);
  }
  if (sourceFilter !== "all") items = items.filter(c => c.source === sourceFilter);
  return items;
}

/** Build regex pattern cache for topic text-matching */
export function buildTopicPatternCache(topics: string[]): Map<string, RegExp> {
  return new Map(topics.map(topic => {
    const escaped = topic.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [topic, new RegExp(`\\b${escaped}\\b`, "i")];
  }));
}

/** Check if a content item matches a topic by tag or text */
export function matchesTopic(
  c: ContentItem,
  topic: string,
  patternCache: Map<string, RegExp>,
): boolean {
  const t = topic.toLowerCase();
  if (c.topics?.some(tag => tag.toLowerCase() === t)) return true;
  return patternCache.get(topic)?.test(c.text) ?? false;
}

/** Compute Dashboard Top 3 with content-level dedup */
export function computeDashboardTop3(
  content: ContentItem[],
  profile: UserPreferenceProfile,
  now: number,
): BriefingItem[] {
  const briefing = generateBriefing(content, profile, now);
  const seenKeys = new Set<string>();
  const deduped = briefing.priority.filter(bi => {
    const key = contentDedup(bi.item);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  return deduped.slice(0, 3);
}

/** Compute Topic Spotlight with cascading dedup from Top3 */
export function computeTopicSpotlight(
  content: ContentItem[],
  profile: UserPreferenceProfile,
  top3: BriefingItem[],
): Array<{ topic: string; items: ContentItem[] }> {
  const highTopics = Object.entries(profile.topicAffinities)
    .filter(([, v]) => v >= 0.3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k]) => k);
  if (highTopics.length === 0) return [];

  const top3Ids = new Set(top3.map(c => c.item.id));
  const qualityItems = content.filter(c => c.verdict === "quality" && !c.flagged && !top3Ids.has(c.id));

  const dedupKeys = new Map<string, string>();
  for (const c of qualityItems) dedupKeys.set(c.id, contentDedup(c));

  const topicPatterns = buildTopicPatternCache(highTopics);

  const usedIds = new Set<string>();
  const usedKeys = new Set(top3.map(bi => contentDedup(bi.item)));
  return highTopics.map(topic => {
    const sorted = qualityItems
      .filter(c => matchesTopic(c, topic, topicPatterns) && !usedIds.has(c.id))
      .sort((a, b) => b.scores.composite - a.scores.composite || a.id.localeCompare(b.id));
    const topicItems: ContentItem[] = [];
    for (const c of sorted) {
      const key = dedupKeys.get(c.id)!;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      usedIds.add(c.id);
      topicItems.push(c);
      if (topicItems.length >= 3) break;
    }
    if (topicItems.length === 0) return null;
    return { topic, items: topicItems };
  }).filter(Boolean) as Array<{ topic: string; items: ContentItem[] }>;
}

/** Activity stats for the dashboard Recent Activity section */
export interface DashboardActivityStats {
  qualityCount: number;
  slopCount: number;
  totalEvaluated: number;
  recentActions: ContentItem[];
  chartQuality: number[];
  chartSlop: number[];
}

export function computeDashboardActivity(
  content: ContentItem[],
  activityRange: "today" | "7d" | "30d",
  now?: number,
): DashboardActivityStats {
  const _now = now ?? Date.now();
  const dayMs = 86400000;
  const rangeDays = activityRange === "30d" ? 30 : activityRange === "7d" ? 7 : 1;
  const rangeStart = _now - rangeDays * dayMs;
  const rangeItems = content.filter(c => c.createdAt >= rangeStart);
  const actionLimit = activityRange === "today" ? 3 : 5;
  const recentActions = content
    .filter(c => c.validated || c.flagged)
    .sort((a, b) => (b.validatedAt ?? b.createdAt) - (a.validatedAt ?? a.createdAt))
    .slice(0, actionLimit);
  const chartDays = Math.min(rangeDays, 30);
  const chartQuality: number[] = [];
  const chartSlop: number[] = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const dayStart = _now - (i + 1) * dayMs;
    const dayEnd = _now - i * dayMs;
    const dayItems = content.filter(c => c.createdAt >= dayStart && c.createdAt < dayEnd);
    const dayQual = dayItems.filter(c => c.verdict === "quality").length;
    const dayTotal = dayItems.length;
    chartQuality.push(dayTotal > 0 ? Math.round((dayQual / dayTotal) * 100) : 0);
    chartSlop.push(dayItems.filter(c => c.verdict === "slop").length);
  }
  return {
    qualityCount: rangeItems.filter(c => c.verdict === "quality").length,
    slopCount: rangeItems.filter(c => c.verdict === "slop").length,
    totalEvaluated: rangeItems.length,
    recentActions,
    chartQuality,
    chartSlop,
  };
}

/** Compute validated items for the Saved for Later section, excluding shown items */
export function computeDashboardValidated(
  content: ContentItem[],
  excludeIds: Set<string>,
): ContentItem[] {
  return content
    .filter(c => c.validated && !excludeIds.has(c.id))
    .sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0))
    .slice(0, 5);
}

/** Compute unreviewed quality items for the review queue, excluding shown items */
export function computeUnreviewedQueue(
  content: ContentItem[],
  excludeIds: Set<string>,
): ContentItem[] {
  return content
    .filter(c => c.verdict === "quality" && !c.validated && !c.flagged && !excludeIds.has(c.id))
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .slice(0, 5);
}

/** Topic distribution entry */
export interface TopicDistEntry {
  topic: string;
  count: number;
  qualityRate: number;
}

/** Compute topic frequency distribution across all content */
export function computeTopicDistribution(
  content: ContentItem[],
): TopicDistEntry[] {
  const topicStats = new Map<string, { total: number; quality: number }>();
  for (const item of content) {
    if (!item.topics) continue;
    for (const topic of item.topics) {
      const t = topic.toLowerCase();
      const stats = topicStats.get(t) ?? { total: 0, quality: 0 };
      stats.total++;
      if (item.verdict === "quality") stats.quality++;
      topicStats.set(t, stats);
    }
  }
  return Array.from(topicStats.entries())
    .map(([topic, stats]) => ({
      topic,
      count: stats.total,
      qualityRate: stats.total > 0 ? stats.quality / stats.total : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}
