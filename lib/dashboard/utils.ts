import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { BriefingItem } from "@/lib/briefing/types";
import { generateBriefing } from "@/lib/briefing/ranker";
import { extractYouTubeVideoId } from "@/lib/utils/youtube";

function hasVisualContent(item: ContentItem): boolean {
  if (item.imageUrl) return true;
  if (item.sourceUrl && extractYouTubeVideoId(item.sourceUrl)) return true;
  return false;
}

/** Content-level dedup key: same article may have different IDs/URLs across sources */
export function contentDedup(item: ContentItem): string {
  return item.text
    .toLowerCase()
    .replace(/[.,!?;:()\[\]{}"'`]/g, "")
    .replace(/\s+/g, " ") // \s+ covers newlines too
    .trim()
    .slice(0, 150);
}

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

/** Latest mode: exclude slop, sort by createdAt descending (newest first). */
export function applyLatestFilter(
  content: ContentItem[],
  verdictFilter: "all" | "quality" | "slop" | "validated" | "bookmarked",
  sourceFilter: string,
  bookmarkedIds: string[],
): ContentItem[] {
  let items = content;

  if (verdictFilter === "bookmarked") {
    const bookmarkSet = new Set(bookmarkedIds);
    items = items.filter(c => bookmarkSet.has(c.id));
  } else if (verdictFilter === "validated") {
    items = items.filter(c => c.validated);
  } else if (verdictFilter === "slop") {
    items = items.filter(c => c.verdict === "slop");
  } else {
    // "all" and "quality" both exclude slop in Latest mode
    items = items.filter(c => c.verdict !== "slop");
  }

  if (sourceFilter !== "all") items = items.filter(c => c.source === sourceFilter);

  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

export function buildTopicPatternCache(topics: string[]): Map<string, RegExp> {
  return new Map(topics.map(topic => {
    const escaped = topic.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [topic, new RegExp(`\\b${escaped}\\b`, "i")];
  }));
}

export function matchesTopic(
  c: ContentItem,
  topic: string,
  patternCache: Map<string, RegExp>,
): boolean {
  const t = topic.toLowerCase();
  if (c.topics?.some(tag => tag.toLowerCase() === t)) return true;
  return patternCache.get(topic)?.test(c.text) ?? false;
}

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
      .sort((a, b) => {
        const va = hasVisualContent(a) ? 1 : 0;
        const vb = hasVisualContent(b) ? 1 : 0;
        if (va !== vb) return vb - va;
        return b.scores.composite - a.scores.composite || a.id.localeCompare(b.id);
      });
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
  const currentTime = now ?? Date.now();
  const dayMs = 86400000;
  const days = activityRange === "30d" ? 30 : activityRange === "7d" ? 7 : 1;
  const rangeStart = currentTime - days * dayMs;

  // Single-pass: bucket items by day and accumulate range stats
  const dayQualityCounts = new Array<number>(days).fill(0);
  const dayTotalCounts = new Array<number>(days).fill(0);
  const daySlopCounts = new Array<number>(days).fill(0);
  let qualityCount = 0;
  let slopCount = 0;
  let totalEvaluated = 0;
  const actionCandidates: ContentItem[] = [];

  for (const c of content) {
    if (c.createdAt >= rangeStart) {
      totalEvaluated++;
      if (c.verdict === "quality") qualityCount++;
      else if (c.verdict === "slop") slopCount++;

      if (c.createdAt <= currentTime) {
        const dayIndex = Math.min(Math.floor((c.createdAt - rangeStart) / dayMs), days - 1);
        dayTotalCounts[dayIndex]++;
        if (c.verdict === "quality") dayQualityCounts[dayIndex]++;
        if (c.verdict === "slop") daySlopCounts[dayIndex]++;
      }
    }
    if (c.validated || c.flagged) actionCandidates.push(c);
  }

  const actionLimit = activityRange === "today" ? 3 : 5;
  const recentActions = actionCandidates
    .sort((a, b) => (b.validatedAt ?? b.createdAt) - (a.validatedAt ?? a.createdAt))
    .slice(0, actionLimit);

  const chartQuality: number[] = [];
  const chartSlop: number[] = [];
  for (let i = 0; i < days; i++) {
    const total = dayTotalCounts[i];
    chartQuality.push(total > 0 ? Math.round((dayQualityCounts[i] / total) * 100) : 0);
    chartSlop.push(daySlopCounts[i]);
  }

  return { qualityCount, slopCount, totalEvaluated, recentActions, chartQuality, chartSlop };
}

export function computeDashboardSaved(
  content: ContentItem[],
  bookmarkedIds: string[],
  excludeIds: Set<string>,
): ContentItem[] {
  const bookmarkSet = new Set(bookmarkedIds);
  return content
    .filter(c =>
      bookmarkSet.has(c.id) &&
      !excludeIds.has(c.id) &&
      !c.validated &&
      !c.flagged
    )
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .slice(0, 5);
}

export function computeUnreviewedQueue(
  content: ContentItem[],
  excludeIds: Set<string>,
): ContentItem[] {
  const seenKeys = new Set<string>();
  return content
    .filter(c => c.verdict === "quality" && !c.validated && !c.flagged && !excludeIds.has(c.id))
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .filter(c => {
      const key = contentDedup(c);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    })
    .slice(0, 5);
}

export interface TopicDistEntry {
  topic: string;
  count: number;
  qualityRate: number;
}

export function computeTopicDistribution(
  content: ContentItem[],
): TopicDistEntry[] {
  const topicStats = new Map<string, { total: number; quality: number }>();
  for (const item of content) {
    if (!item.topics) continue;
    for (const topic of item.topics) {
      const t = topic.toLowerCase();
      let stats = topicStats.get(t);
      if (!stats) { stats = { total: 0, quality: 0 }; topicStats.set(t, stats); }
      stats.total++;
      if (item.verdict === "quality") stats.quality++;
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

// ── Topic Trends ────────────────────────────────────────────

export interface TopicTrend {
  topic: string;
  currentCount: number;
  previousCount: number;
  changePercent: number;
  direction: "up" | "down" | "stable";
  weeklyHistory: number[];
}

export function computeTopicTrends(content: ContentItem[], weeks = 4): TopicTrend[] {
  const now = Date.now();
  const weekMs = 7 * 86400000;
  const windowStart = now - weeks * weekMs;

  // Single-pass: assign each item to its week bucket
  const weekBuckets: Map<string, number>[] = Array.from({ length: weeks }, () => new Map());
  for (const item of content) {
    if (item.createdAt < windowStart || item.createdAt > now) continue;
    if (!item.topics) continue;
    // weekIndex 0 = most recent week
    const weekIndex = Math.min(Math.floor((now - item.createdAt) / weekMs), weeks - 1);
    const bucket = weekBuckets[weekIndex];
    for (const topic of item.topics) {
      const t = topic.toLowerCase();
      bucket.set(t, (bucket.get(t) ?? 0) + 1);
    }
  }

  const allTopics = new Set<string>();
  for (const bucket of weekBuckets.slice(0, 2)) {
    for (const topic of bucket.keys()) allTopics.add(topic);
  }

  const trends: TopicTrend[] = [];
  for (const topic of allTopics) {
    const current = weekBuckets[0]?.get(topic) ?? 0;
    const previous = weekBuckets[1]?.get(topic) ?? 0;
    const changePercent = previous === 0
      ? (current > 0 ? 100 : 0)
      : Math.round(((current - previous) / previous) * 100);
    const direction: TopicTrend["direction"] =
      changePercent > 10 ? "up" : changePercent < -10 ? "down" : "stable";
    const weeklyHistory = weekBuckets.map(b => b.get(topic) ?? 0).reverse();

    trends.push({ topic, currentCount: current, previousCount: previous, changePercent, direction, weeklyHistory });
  }

  return trends.sort((a, b) => b.currentCount - a.currentCount).slice(0, 8);
}

// ── Story Clustering ────────────────────────────────────────

export interface StoryCluster {
  representative: ContentItem;
  members: ContentItem[];
  sharedTopics: string[];
}

class UnionFind {
  private parent: number[];
  private rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) { this.parent[ra] = rb; }
    else if (this.rank[ra] > this.rank[rb]) { this.parent[rb] = ra; }
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }
}

export function titleWordOverlap(a: string, b: string): number {
  const extract = (s: string) => {
    const words = s.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    return new Set(words);
  };
  const sa = extract(a);
  const sb = extract(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const w of sa) if (sb.has(w)) intersection++;
  // Jaccard similarity: |A∩B| / |A∪B|
  return intersection / (sa.size + sb.size - intersection);
}

const CLUSTER_TIME_WINDOW_MS = 48 * 60 * 60 * 1000;

const CLUSTER_CAP = 150;

export function clusterByStory(items: ContentItem[]): StoryCluster[] {
  if (items.length === 0) return [];

  // Sort by composite desc so we cluster the best-scored items first
  const allSorted = [...items].sort((a, b) => b.scores.composite - a.scores.composite);
  const sorted = allSorted.slice(0, CLUSTER_CAP);
  const overflow = allSorted.slice(CLUSTER_CAP);

  const topicSets = sorted.map(it =>
    new Set((it.topics ?? []).map(t => t.toLowerCase()))
  );
  const wordSets = sorted.map(it => {
    const words = it.text.slice(0, 200).toLowerCase().split(/\s+/).filter(w => w.length > 2);
    return new Set(words);
  });

  // Re-sort by createdAt desc for time-window break
  const timeOrder = sorted.map((_, i) => i).sort((a, b) => sorted[b].createdAt - sorted[a].createdAt);

  const uf = new UnionFind(sorted.length);

  for (let ri = 0; ri < timeOrder.length; ri++) {
    const i = timeOrder[ri];
    for (let rj = ri + 1; rj < timeOrder.length; rj++) {
      const j = timeOrder[rj];
      const timeDiff = sorted[i].createdAt - sorted[j].createdAt;
      if (timeDiff > CLUSTER_TIME_WINDOW_MS) break; // sorted desc → all subsequent are older

      const si = topicSets[i];
      const sj = topicSets[j];
      if (si.size === 0 || sj.size === 0) continue;

      let shared = 0;
      for (const t of si) if (sj.has(t)) shared++;

      if (shared >= 2) {
        uf.union(i, j);
      } else if (shared === 1) {
        // Use pre-computed word sets instead of recomputing
        const wa = wordSets[i];
        const wb = wordSets[j];
        if (wa.size > 0 && wb.size > 0) {
          let intersection = 0;
          for (const w of wa) if (wb.has(w)) intersection++;
          const jaccard = intersection / (wa.size + wb.size - intersection);
          if (jaccard >= 0.4) uf.union(i, j);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < sorted.length; i++) {
    const root = uf.find(i);
    const arr = groups.get(root);
    if (arr) arr.push(i); else groups.set(root, [i]);
  }

  const clusters: StoryCluster[] = [];
  for (const indices of groups.values()) {
    const members = indices.map(i => sorted[i]);
    members.sort((a, b) => b.scores.composite - a.scores.composite);
    const representative = members[0];

    const commonTopics: string[] = [];
    if (members.length > 1) {
      const first = topicSets[indices[0]];
      for (const t of first) {
        if (indices.every(i => topicSets[i].has(t))) commonTopics.push(t);
      }
    }

    clusters.push({ representative, members, sharedTopics: commonTopics });
  }

  // Append overflow items as singleton clusters (already sorted by composite desc)
  for (const item of overflow) {
    clusters.push({ representative: item, members: [item], sharedTopics: [] });
  }

  clusters.sort((a, b) => b.representative.scores.composite - a.representative.scores.composite);
  return clusters;
}
