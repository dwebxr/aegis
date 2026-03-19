import { runFilterPipeline } from "@/lib/filtering/pipeline";
import type { ContentItem } from "@/lib/types/content";
import type { FilterConfig } from "@/lib/filtering/types";
import { createEmptyProfile } from "@/lib/preferences/types";

jest.mock("uuid", () => ({ v4: () => "test-uuid" }));

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "Test Author",
    avatar: "T",
    text: "Test content",
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

describe("runFilterPipeline — content serendipity (non-WoT path)", () => {
  it("detects content serendipity for cold-start profile with high-quality item", () => {
    const profile = createEmptyProfile("test");
    // Cold start: no data, threshold is 8.0
    const items = [makeItem({
      nostrPubkey: undefined,
      scores: { originality: 9, insight: 9, credibility: 9, composite: 8.5 },
    })];
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 0, profile };
    const result = runFilterPipeline(items, null, config);
    expect(result.items[0].isContentSerendipity).toBe(true);
    expect(result.stats.serendipityCount).toBe(1);
  });

  it("does NOT detect content serendipity at cold-start threshold boundary (score <= 8.0)", () => {
    const profile = createEmptyProfile("test");
    const items = [makeItem({
      nostrPubkey: undefined,
      scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 },
    })];
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 0, profile };
    const result = runFilterPipeline(items, null, config);
    expect(result.items[0].isContentSerendipity).toBe(false);
  });

  it("detects content serendipity for novel topic with personalized profile", () => {
    const profile = createEmptyProfile("test");
    profile.totalValidated = 20;
    profile.totalFlagged = 5;
    // Established profile with known topics
    profile.topicAffinities = { ai: 0.8, crypto: -0.5 };
    profile.authorTrust = { "Known Author": { validates: 5, flags: 0, trust: 0.7 } };

    // Item with topic NOT in user's affinities and unknown author
    const items = [makeItem({
      nostrPubkey: undefined,
      topics: ["gardening"],
      author: "New Author",
      scores: { originality: 8, insight: 8, credibility: 8, composite: 7.5 },
    })];
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 0, profile };
    const result = runFilterPipeline(items, null, config);
    expect(result.items[0].isContentSerendipity).toBe(true);
  });

  it("does NOT detect content serendipity for known author", () => {
    const profile = createEmptyProfile("test");
    profile.totalValidated = 20;
    profile.totalFlagged = 5;
    profile.topicAffinities = { tech: 0.8 };
    profile.authorTrust = { "Known Author": { validates: 5, flags: 0, trust: 0.7 } };

    const items = [makeItem({
      nostrPubkey: undefined,
      topics: ["tech"],
      author: "Known Author",
      scores: { originality: 8, insight: 8, credibility: 8, composite: 7.5 },
    })];
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 0, profile };
    const result = runFilterPipeline(items, null, config);
    // Author is known AND topic affinity is high → not serendipity
    expect(result.items[0].isContentSerendipity).toBe(false);
  });

  it("does NOT detect content serendipity for low-quality items", () => {
    const profile = createEmptyProfile("test");
    profile.totalValidated = 20;
    profile.totalFlagged = 5;

    const items = [makeItem({
      nostrPubkey: undefined,
      topics: ["novel_topic"],
      author: "New Author",
      scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 },
    })];
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 0, profile };
    const result = runFilterPipeline(items, null, config);
    expect(result.items[0].isContentSerendipity).toBe(false);
  });

  it("does NOT detect content serendipity when item has WoT score", () => {
    // WoT serendipity takes precedence — content serendipity is only for non-WoT items
    const profile = createEmptyProfile("test");
    profile.totalValidated = 20;
    profile.totalFlagged = 5;

    const items = [makeItem({
      nostrPubkey: "pk-a",
      topics: ["novel_topic"],
      author: "New Author",
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 },
    })];
    const config: FilterConfig = {
      mode: "pro",
      wotEnabled: true,
      qualityThreshold: 0,
      profile,
    };
    // With a wot graph, WoT will score the item, so content serendipity won't apply
    const graph = {
      userPubkey: "user",
      nodes: new Map([["user", { pubkey: "user", follows: [], hopDistance: 0, mutualFollows: 0 }]]),
      maxHops: 3,
      builtAt: Date.now(),
    };
    const result = runFilterPipeline(items, graph, config);
    // The item gets WoT scored, so isContentSerendipity should be false
    expect(result.items[0].isContentSerendipity).toBe(false);
  });

  it("handles undefined profile gracefully", () => {
    const items = [makeItem({
      nostrPubkey: undefined,
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 },
    })];
    // No profile → cold start → threshold 8.0, score 9.0 > 8.0 → serendipity
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 0 };
    const result = runFilterPipeline(items, null, config);
    expect(result.items[0].isContentSerendipity).toBe(true);
  });

  it("counts both WoT and content serendipity in stats", () => {
    const profile = createEmptyProfile("test");

    const items = [
      // Content serendipity: high quality, no WoT, cold start
      makeItem({
        id: "content-s",
        nostrPubkey: undefined,
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 },
      }),
      // Regular item below cold-start threshold
      makeItem({
        id: "regular",
        nostrPubkey: undefined,
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7.0 },
      }),
    ];
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 0, profile };
    const result = runFilterPipeline(items, null, config);
    expect(result.stats.serendipityCount).toBe(1);
  });
});
