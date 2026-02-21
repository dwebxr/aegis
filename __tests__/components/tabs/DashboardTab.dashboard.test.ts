/**
 * Dashboard mode tests — Top 3, Topic Spotlight, Saved for Later, Recent Activity.
 * All functions imported from lib/dashboard/utils (shared with DashboardTab component).
 */
import { generateBriefing } from "@/lib/briefing/ranker";
import {
  computeDashboardTop3,
  computeTopicSpotlight,
  computeDashboardActivity,
  computeDashboardValidated,
} from "@/lib/dashboard/utils";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "T",
    text: "Test content text for testing purposes with enough words",
    source: "manual",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["ai"],
    ...overrides,
  };
}

describe("Dashboard mode — Today's Top 3", () => {
  it("returns top 3 from generateBriefing priority", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `item-${i}`, text: `Unique article number ${i} for dashboard ranking`, scores: { originality: 5, insight: 5, credibility: 5, composite: i + 1 } }),
    );
    const profile = createEmptyProfile("test");
    const top3 = computeDashboardTop3(items, profile, Date.now());
    expect(top3).toHaveLength(3);
    // Highest composites first (after briefingScore weighting)
    expect(top3[0].briefingScore).toBeGreaterThanOrEqual(top3[1].briefingScore);
  });

  it("returns fewer than 3 when content is sparse", () => {
    const items = [makeItem({ scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } })];
    const profile = createEmptyProfile("test");
    const top3 = computeDashboardTop3(items, profile, Date.now());
    expect(top3).toHaveLength(1);
  });

  it("returns empty for all-slop content", () => {
    const items = [makeItem({ verdict: "slop", scores: { originality: 1, insight: 1, credibility: 1, composite: 1 } })];
    const profile = createEmptyProfile("test");
    const top3 = computeDashboardTop3(items, profile, Date.now());
    expect(top3).toHaveLength(0);
  });
});

describe("Dashboard mode — Topic Spotlight", () => {
  const now = Date.now();

  it("selects best item per high-affinity topic", () => {
    const profile = {
      ...createEmptyProfile("test"),
      topicAffinities: { ai: 0.5, crypto: 0.4, cooking: 0.1 },
    };
    const items = [
      makeItem({ id: "a1", topics: ["ai"], text: "AI article one unique text", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "a2", topics: ["ai"], text: "AI article two unique text", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
      makeItem({ id: "c1", topics: ["crypto"], text: "Crypto article unique text", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "k1", topics: ["cooking"], text: "Cooking article unique text", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];
    // Fillers to keep test items out of Top3
    const fillers = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `fill-${i}`, topics: ["other"], text: `Filler ${i} unique`, scores: { originality: 20, insight: 20, credibility: 20, composite: 20 } }),
    );
    const allItems = [...fillers, ...items];

    const top3 = computeDashboardTop3(allItems, profile, now);
    const spotlight = computeTopicSpotlight(allItems, profile, top3);

    const aiGroup = spotlight.find(g => g.topic === "ai");
    const cryptoGroup = spotlight.find(g => g.topic === "crypto");
    const cookingGroup = spotlight.find(g => g.topic === "cooking");

    expect(aiGroup).toBeDefined();
    expect(cryptoGroup).toBeDefined();
    expect(cookingGroup).toBeUndefined(); // 0.1 < 0.3 threshold
    expect(aiGroup!.items[0].scores.composite).toBe(8);
    expect(cryptoGroup!.items[0].scores.composite).toBe(9);
  });

  it("returns empty when no high-affinity topics exist", () => {
    const profile = {
      ...createEmptyProfile("test"),
      topicAffinities: { ai: 0.1, crypto: 0.2 },
    };
    const items = [makeItem()];
    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);
    expect(spotlight).toHaveLength(0);
  });

  it("caps at 5 topics", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 10; i++) affinities[`topic-${i}`] = 0.5 + i * 0.01;
    const profile = { ...createEmptyProfile("test"), topicAffinities: affinities };
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `t-${i}`, topics: [`topic-${i}`], text: `Topic ${i} article unique`, scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    );
    const fillers = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `fill-${i}`, topics: ["other"], text: `Filler ${i}`, scores: { originality: 20, insight: 20, credibility: 20, composite: 20 } }),
    );
    const top3 = computeDashboardTop3([...fillers, ...items], profile, now);
    const spotlight = computeTopicSpotlight([...fillers, ...items], profile, top3);
    expect(spotlight.length).toBeLessThanOrEqual(5);
  });
});

describe("Dashboard mode — Saved for Later", () => {
  it("returns validated items sorted by validatedAt descending", () => {
    const items = [
      makeItem({ id: "v1", validated: true, validatedAt: 1000 }),
      makeItem({ id: "v2", validated: true, validatedAt: 3000 }),
      makeItem({ id: "v3", validated: true, validatedAt: 2000 }),
      makeItem({ id: "nv", validated: false }),
    ];
    const result = computeDashboardValidated(items, new Set());

    expect(result).toHaveLength(3);
    expect(result[0].validatedAt).toBe(3000);
    expect(result[1].validatedAt).toBe(2000);
    expect(result[2].validatedAt).toBe(1000);
  });

  it("caps at 5 items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `v-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const result = computeDashboardValidated(items, new Set());
    expect(result).toHaveLength(5);
  });
});

describe("Dashboard mode — Recent Activity", () => {
  const now = Date.now();

  it("today range: counts only last 24h items", () => {
    const dayMs = 86400000;
    const items = [
      makeItem({ id: "t1", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "t2", createdAt: now - 2000, verdict: "slop" }),
      makeItem({ id: "old", createdAt: now - dayMs - 1000, verdict: "quality" }),
    ];
    const result = computeDashboardActivity(items, "today", now);
    expect(result.qualityCount).toBe(1);
    expect(result.slopCount).toBe(1);
    expect(result.totalEvaluated).toBe(2);
  });

  it("7d range: includes items from last 7 days", () => {
    const dayMs = 86400000;
    const items = [
      makeItem({ id: "d0", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "d3", createdAt: now - 3 * dayMs, verdict: "quality" }),
      makeItem({ id: "d6", createdAt: now - 6 * dayMs, verdict: "slop" }),
      makeItem({ id: "d8", createdAt: now - 8 * dayMs, verdict: "quality" }), // outside 7d
    ];
    const result = computeDashboardActivity(items, "7d", now);
    expect(result.qualityCount).toBe(2);
    expect(result.slopCount).toBe(1);
    expect(result.totalEvaluated).toBe(3);
  });

  it("30d range: includes items from last 30 days", () => {
    const dayMs = 86400000;
    const items = [
      makeItem({ id: "d0", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "d15", createdAt: now - 15 * dayMs, verdict: "slop" }),
      makeItem({ id: "d29", createdAt: now - 29 * dayMs, verdict: "quality" }),
      makeItem({ id: "d31", createdAt: now - 31 * dayMs, verdict: "quality" }), // outside 30d
    ];
    const result = computeDashboardActivity(items, "30d", now);
    expect(result.qualityCount).toBe(2);
    expect(result.slopCount).toBe(1);
    expect(result.totalEvaluated).toBe(3);
  });

  it("today range: limits recent actions to 3", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const result = computeDashboardActivity(items, "today", now);
    expect(result.recentActions).toHaveLength(3);
    expect(result.recentActions[0].validatedAt).toBe(5000);
  });

  it("7d range: limits recent actions to 5", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const result = computeDashboardActivity(items, "7d", now);
    expect(result.recentActions).toHaveLength(5);
  });

  it("30d range: limits recent actions to 5", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true, validatedAt: i * 1000 }),
    );
    const result = computeDashboardActivity(items, "30d", now);
    expect(result.recentActions).toHaveLength(5);
  });

  it("chart data has correct number of days", () => {
    const items = [makeItem({ createdAt: now - 1000 })];
    expect(computeDashboardActivity(items, "today", now).chartQuality).toHaveLength(1);
    expect(computeDashboardActivity(items, "7d", now).chartQuality).toHaveLength(7);
    expect(computeDashboardActivity(items, "30d", now).chartQuality).toHaveLength(30);
  });

  it("chart data computes quality percentage per day", () => {
    // 2 quality, 1 slop in the most recent day bucket
    const items = [
      makeItem({ id: "q1", createdAt: now - 1000, verdict: "quality" }),
      makeItem({ id: "q2", createdAt: now - 2000, verdict: "quality" }),
      makeItem({ id: "s1", createdAt: now - 3000, verdict: "slop" }),
    ];
    const result = computeDashboardActivity(items, "today", now);
    // Last entry = most recent day: 2 quality / 3 total = 67%
    expect(result.chartQuality[result.chartQuality.length - 1]).toBe(67);
    expect(result.chartSlop[result.chartSlop.length - 1]).toBe(1);
  });
});
