import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { BriefingItem } from "@/lib/briefing/types";
import { generateBriefing } from "@/lib/briefing/ranker";
import { extractYouTubeVideoId } from "@/lib/utils/youtube";

/** True if item has an image or a YouTube video (matches ThumbnailArea display logic). */
function hasVisualContent(item: ContentItem): boolean {
  if (item.imageUrl) return true;
  if (item.sourceUrl && extractYouTubeVideoId(item.sourceUrl)) return true;
  return false;
}

/** Content-level dedup key: same article may have different IDs/URLs across sources */
export function contentDedup(item: ContentItem): string {
  return item.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
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
  // Exclude validated items — they appear in the Validated section
  const fresh = content.filter(c => !c.validated);
  const briefing = generateBriefing(fresh, profile, now);
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
  const qualityItems = content.filter(c => c.verdict === "quality" && !c.flagged && !c.validated && !top3Ids.has(c.id));

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

export function computeDashboardValidated(
  content: ContentItem[],
  excludeIds: Set<string>,
): ContentItem[] {
  return content
    .filter(c => c.validated && !excludeIds.has(c.id))
    .sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0))
    .slice(0, 5);
}

export function computeUnreviewedQueue(
  content: ContentItem[],
  excludeIds: Set<string>,
): ContentItem[] {
  return content
    .filter(c => c.verdict === "quality" && !c.validated && !c.flagged && !excludeIds.has(c.id))
    .sort((a, b) => b.scores.composite - a.scores.composite)
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
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const CLUSTER_TIME_WINDOW_MS = 48 * 60 * 60 * 1000;

export function clusterByStory(items: ContentItem[]): StoryCluster[] {
  if (items.length === 0) return [];

  const topicSets = items.map(it =>
    new Set((it.topics ?? []).map(t => t.toLowerCase()))
  );

  const uf = new UnionFind(items.length);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const timeDiff = Math.abs(items[i].createdAt - items[j].createdAt);
      if (timeDiff > CLUSTER_TIME_WINDOW_MS) continue;

      const si = topicSets[i];
      const sj = topicSets[j];
      if (si.size === 0 || sj.size === 0) continue;

      let shared = 0;
      for (const t of si) if (sj.has(t)) shared++;

      if (shared >= 2) {
        uf.union(i, j);
      } else if (shared === 1) {
        if (titleWordOverlap(items[i].text.slice(0, 200), items[j].text.slice(0, 200)) >= 0.4) {
          uf.union(i, j);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const root = uf.find(i);
    const arr = groups.get(root);
    if (arr) arr.push(i); else groups.set(root, [i]);
  }

  const clusters: StoryCluster[] = [];
  for (const indices of groups.values()) {
    const members = indices.map(i => items[i]);
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

  clusters.sort((a, b) => b.representative.scores.composite - a.representative.scores.composite);
  return clusters;
}
