import {
  computeTopicDistribution,
  computeUnreviewedQueue,
  computeDashboardTop3,
  computeTopicSpotlight,
  computeDashboardValidated,
  contentDedup,
} from "@/lib/dashboard/utils";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "T",
    text: `Unique text ${Math.random().toString(36).slice(2)} for dedup safety`,
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality" as const,
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["ai"],
    ...overrides,
  };
}

function makeProfile(affinities: Record<string, number> = {}): UserPreferenceProfile {
  return {
    ...createEmptyProfile("test"),
    topicAffinities: affinities,
  };
}

// ─── computeTopicDistribution ───

describe("computeTopicDistribution", () => {
  it("counts topics across multiple items", () => {
    const items = [
      makeItem({ topics: ["ai", "crypto"] }),
      makeItem({ topics: ["ai", "web3"] }),
      makeItem({ topics: ["ai"] }),
    ];
    const dist = computeTopicDistribution(items);
    const aiEntry = dist.find(d => d.topic === "ai");
    expect(aiEntry).toBeDefined();
    expect(aiEntry!.count).toBe(3);
  });

  it("calculates quality rate correctly", () => {
    const items = [
      makeItem({ topics: ["ai"], verdict: "quality" }),
      makeItem({ topics: ["ai"], verdict: "quality" }),
      makeItem({ topics: ["ai"], verdict: "slop" }),
    ];
    const dist = computeTopicDistribution(items);
    const aiEntry = dist.find(d => d.topic === "ai");
    expect(aiEntry!.qualityRate).toBeCloseTo(2 / 3);
  });

  it("returns empty array when no items have topics", () => {
    const items = [
      makeItem({ topics: undefined }),
      makeItem({ topics: [] }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist).toEqual([]);
  });

  it("normalizes topic names to lowercase", () => {
    const items = [
      makeItem({ topics: ["AI"] }),
      makeItem({ topics: ["ai"] }),
      makeItem({ topics: ["Ai"] }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist).toHaveLength(1);
    expect(dist[0].topic).toBe("ai");
    expect(dist[0].count).toBe(3);
  });

  it("sorts by count descending", () => {
    const items = [
      makeItem({ topics: ["rare"] }),
      makeItem({ topics: ["common"] }),
      makeItem({ topics: ["common"] }),
      makeItem({ topics: ["common"] }),
      makeItem({ topics: ["medium"] }),
      makeItem({ topics: ["medium"] }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist[0].topic).toBe("common");
    expect(dist[0].count).toBe(3);
    expect(dist[1].topic).toBe("medium");
    expect(dist[1].count).toBe(2);
    expect(dist[2].topic).toBe("rare");
  });

  it("caps at 8 topics", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ topics: [`topic-${i}`] }),
    );
    const dist = computeTopicDistribution(items);
    expect(dist.length).toBeLessThanOrEqual(8);
  });

  it("handles items with both undefined and valid topics mixed", () => {
    const items = [
      makeItem({ topics: undefined }),
      makeItem({ topics: ["crypto"] }),
      makeItem({ topics: [] }),
      makeItem({ topics: ["crypto", "defi"] }),
    ];
    const dist = computeTopicDistribution(items);
    const crypto = dist.find(d => d.topic === "crypto");
    expect(crypto!.count).toBe(2);
  });

  it("handles empty content array", () => {
    expect(computeTopicDistribution([])).toEqual([]);
  });

  it("quality rate is 0 when all items are slop", () => {
    const items = [
      makeItem({ topics: ["tech"], verdict: "slop" }),
      makeItem({ topics: ["tech"], verdict: "slop" }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist[0].qualityRate).toBe(0);
  });

  it("quality rate is 1 when all items are quality", () => {
    const items = [
      makeItem({ topics: ["tech"], verdict: "quality" }),
      makeItem({ topics: ["tech"], verdict: "quality" }),
    ];
    const dist = computeTopicDistribution(items);
    expect(dist[0].qualityRate).toBe(1);
  });
});

// ─── computeUnreviewedQueue ───

describe("computeUnreviewedQueue", () => {
  it("returns quality unvalidated unflagged items sorted by composite desc", () => {
    const items = [
      makeItem({ id: "low", scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } }),
      makeItem({ id: "high", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "mid", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
    ];
    const queue = computeUnreviewedQueue(items, new Set());
    expect(queue.map(q => q.id)).toEqual(["high", "mid", "low"]);
  });

  it("excludes items in excludeIds", () => {
    const items = [
      makeItem({ id: "a" }),
      makeItem({ id: "b" }),
      makeItem({ id: "c" }),
    ];
    const queue = computeUnreviewedQueue(items, new Set(["a", "c"]));
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("b");
  });

  it("returns empty when all candidates are in excludeIds", () => {
    const items = [makeItem({ id: "x" }), makeItem({ id: "y" })];
    const queue = computeUnreviewedQueue(items, new Set(["x", "y"]));
    expect(queue).toEqual([]);
  });

  it("excludes validated items", () => {
    const items = [
      makeItem({ id: "val", validated: true }),
      makeItem({ id: "unval", validated: false }),
    ];
    const queue = computeUnreviewedQueue(items, new Set());
    expect(queue.map(q => q.id)).toEqual(["unval"]);
  });

  it("excludes flagged items", () => {
    const items = [
      makeItem({ id: "flagged", flagged: true }),
      makeItem({ id: "clean", flagged: false }),
    ];
    const queue = computeUnreviewedQueue(items, new Set());
    expect(queue.map(q => q.id)).toEqual(["clean"]);
  });

  it("excludes slop items", () => {
    const items = [
      makeItem({ id: "slop", verdict: "slop" }),
      makeItem({ id: "quality", verdict: "quality" }),
    ];
    const queue = computeUnreviewedQueue(items, new Set());
    expect(queue.map(q => q.id)).toEqual(["quality"]);
  });

  it("caps at 5 items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `q-${i}`, scores: { originality: 10 - i, insight: 7, credibility: 7, composite: 10 - i } }),
    );
    const queue = computeUnreviewedQueue(items, new Set());
    expect(queue).toHaveLength(5);
  });

  it("returns empty for empty content array", () => {
    expect(computeUnreviewedQueue([], new Set())).toEqual([]);
  });
});

// ─── All-validated edge cases ───

describe("computeDashboardTop3 — validated exclusion", () => {
  const now = Date.now();
  const profile = makeProfile({ ai: 0.8 });

  it("returns empty when all items are validated", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `val-${i}`,
        text: `Validated article ${i} about AI research`,
        validated: true,
        validatedAt: now,
        scores: { originality: 10 - i, insight: 8, credibility: 8, composite: 10 - i },
      }),
    );
    const top3 = computeDashboardTop3(items, profile, now);
    expect(top3).toEqual([]);
  });

  it("only includes unvalidated items in top3", () => {
    const items = [
      makeItem({ id: "val-high", text: "Validated high score AI", validated: true, scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } }),
      makeItem({ id: "unval-low", text: "Unvalidated lower score article", validated: false, scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const ids = top3.map(bi => bi.item.id);
    expect(ids).toContain("unval-low");
    expect(ids).not.toContain("val-high");
  });
});

describe("computeTopicSpotlight — validated exclusion", () => {
  const now = Date.now();

  it("returns empty when all quality items are validated", () => {
    const profile = makeProfile({ ai: 0.8 });
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `val-spot-${i}`,
        text: `Validated AI content ${i}`,
        topics: ["ai"],
        validated: true,
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
      }),
    );
    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);
    expect(spotlight).toEqual([]);
  });

  it("skips validated items but includes unvalidated ones", () => {
    const profile = makeProfile({ ai: 0.8 });
    const items = [
      makeItem({ id: "val", text: "Validated AI article", topics: ["ai"], validated: true, scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } }),
      makeItem({ id: "unval", text: "Unvalidated AI article fresh content", topics: ["ai"], validated: false, scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);
    const allSpotlightIds = spotlight.flatMap(g => g.items.map(it => it.id));
    expect(allSpotlightIds).not.toContain("val");
  });
});

// ─── computeTopicSpotlight — visual hero prioritization ───

describe("computeTopicSpotlight — visual hero prioritization", () => {
  const now = Date.now();
  const profile = makeProfile({ ai: 0.8 });

  // Filler items to occupy Top3 so spotlight candidates aren't absorbed
  const fillers = Array.from({ length: 3 }, (_, i) =>
    makeItem({
      id: `filler-${i}`,
      text: `Top filler content number ${i} unique`,
      topics: ["other"],
      scores: { originality: 20, insight: 20, credibility: 20, composite: 20 },
    }),
  );

  it("image item becomes hero over higher-scoring text-only item", () => {
    const items = [
      ...fillers,
      makeItem({ id: "text-high", text: "High score AI article no image", topics: ["ai"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "img-low", text: "Lower score AI article with image", topics: ["ai"], imageUrl: "https://example.com/photo.jpg", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);
    const aiGroup = spotlight.find(g => g.topic === "ai");
    expect(aiGroup).toBeDefined();
    expect(aiGroup!.items[0].id).toBe("img-low");
  });

  it("YouTube URL item becomes hero over higher-scoring text-only item", () => {
    const items = [
      ...fillers,
      makeItem({ id: "text-high", text: "High score AI article no video", topics: ["ai"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "yt-low", text: "Lower score AI video content", topics: ["ai"], sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);
    const aiGroup = spotlight.find(g => g.topic === "ai");
    expect(aiGroup).toBeDefined();
    expect(aiGroup!.items[0].id).toBe("yt-low");
  });

  it("without visual items, falls back to composite score order", () => {
    const items = [
      ...fillers,
      makeItem({ id: "low", text: "Low score AI article text only", topics: ["ai"], scores: { originality: 4, insight: 4, credibility: 4, composite: 4 } }),
      makeItem({ id: "high", text: "High score AI article text only", topics: ["ai"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);
    const aiGroup = spotlight.find(g => g.topic === "ai");
    expect(aiGroup).toBeDefined();
    expect(aiGroup!.items[0].id).toBe("high");
  });

  it("among visual items, higher composite wins hero", () => {
    const items = [
      ...fillers,
      makeItem({ id: "img-low", text: "Low visual AI article", topics: ["ai"], imageUrl: "https://example.com/a.jpg", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
      makeItem({ id: "img-high", text: "High visual AI article", topics: ["ai"], imageUrl: "https://example.com/b.jpg", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);
    const aiGroup = spotlight.find(g => g.topic === "ai");
    expect(aiGroup).toBeDefined();
    expect(aiGroup!.items[0].id).toBe("img-high");
  });
});

// ─── computeDashboardValidated edge cases ───

describe("computeDashboardValidated — edge cases", () => {
  it("returns empty for empty content array", () => {
    expect(computeDashboardValidated([], new Set())).toEqual([]);
  });

  it("returns empty when no items are validated", () => {
    const items = [makeItem({ validated: false }), makeItem({ validated: false })];
    expect(computeDashboardValidated(items, new Set())).toEqual([]);
  });

  it("sorts by validatedAt descending (most recent first)", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "old", validated: true, validatedAt: now - 10000 }),
      makeItem({ id: "new", validated: true, validatedAt: now }),
      makeItem({ id: "mid", validated: true, validatedAt: now - 5000 }),
    ];
    const validated = computeDashboardValidated(items, new Set());
    expect(validated.map(v => v.id)).toEqual(["new", "mid", "old"]);
  });

  it("excludes items in excludeIds set", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "shown", validated: true, validatedAt: now }),
      makeItem({ id: "hidden", validated: true, validatedAt: now }),
    ];
    const validated = computeDashboardValidated(items, new Set(["shown"]));
    expect(validated.map(v => v.id)).toEqual(["hidden"]);
  });
});

// ─── contentDedup collision scenario ───

describe("contentDedup — collision edge cases", () => {
  it("two items with empty text produce same key", () => {
    const a = makeItem({ text: "" });
    const b = makeItem({ text: "   " });
    expect(contentDedup(a)).toBe(contentDedup(b));
    expect(contentDedup(a)).toBe("");
  });

  it("items differing only after 120 chars produce same key", () => {
    const prefix = "a".repeat(120);
    const a = makeItem({ text: prefix + " UNIQUE_SUFFIX_A" });
    const b = makeItem({ text: prefix + " UNIQUE_SUFFIX_B" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("items differing within 120 chars produce different keys", () => {
    const a = makeItem({ text: "Article about AI safety in 2024" });
    const b = makeItem({ text: "Article about crypto regulation in 2024" });
    expect(contentDedup(a)).not.toBe(contentDedup(b));
  });
});
