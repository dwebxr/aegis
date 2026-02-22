/**
 * Tests for Dashboard content dedup and ranking stability.
 *
 * Covers:
 * - contentDedup key generation (normalization, edge cases)
 * - Cross-section dedup (Top3 → Spotlight → Discoveries → Validated)
 * - Within-topic iterative dedup
 * - briefingNowRef pinning (stable rankings across recomputation)
 * - Cascading dedup chain integrity
 */
import { contentDedup, computeDashboardTop3, computeTopicSpotlight, computeDashboardValidated } from "@/lib/dashboard/utils";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "T",
    text: "Test content text for testing purposes with enough words to be meaningful",
    source: "rss",
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

function makeProfile(affinities: Record<string, number> = {}): UserPreferenceProfile {
  return {
    ...createEmptyProfile("test"),
    topicAffinities: affinities,
  };
}

// ─── contentDedup key generation ───

describe("contentDedup — key generation", () => {
  it("normalizes whitespace", () => {
    const a = makeItem({ text: "Bitcoin   reaches\tnew  ATH\n\ntoday" });
    const b = makeItem({ text: "bitcoin reaches new ath today" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("is case-insensitive", () => {
    const a = makeItem({ text: "Bitcoin Reaches New ATH Today" });
    const b = makeItem({ text: "bitcoin reaches new ath today" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("truncates to 120 chars", () => {
    const longText = "a".repeat(300);
    const item = makeItem({ text: longText });
    expect(contentDedup(item)).toHaveLength(120);
  });

  it("produces different keys for different articles", () => {
    const a = makeItem({ text: "Bitcoin reaches new all-time high driven by institutional buying" });
    const b = makeItem({ text: "Ethereum upgrades to proof-of-stake in landmark network transition" });
    expect(contentDedup(a)).not.toBe(contentDedup(b));
  });

  it("matches articles with minor formatting differences", () => {
    const a = makeItem({ text: "  Bitcoin reaches new ATH today — analysts say  " });
    const b = makeItem({ text: "bitcoin reaches new ath today — analysts say" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("handles empty text", () => {
    const item = makeItem({ text: "" });
    expect(contentDedup(item)).toBe("");
  });

  it("handles whitespace-only text", () => {
    const item = makeItem({ text: "   \t\n   " });
    expect(contentDedup(item)).toBe("");
  });
});

// ─── Top3 content-level dedup ───

describe("Dashboard Top3 — content-level dedup", () => {
  const now = Date.now();
  const profile = makeProfile({ ai: 0.5 });

  it("removes duplicate articles with different IDs but same text", () => {
    const items = [
      makeItem({ id: "a1", text: "Bitcoin reaches new ATH today with record volume", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "a2", text: "Bitcoin reaches new ATH today with record volume", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "b1", text: "Ethereum upgrades successfully to latest protocol", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
      makeItem({ id: "c1", text: "AI models show breakthrough performance gains", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const ids = top3.map(bi => bi.item.id);
    // a1 and a2 have the same text → only a1 (higher score) should be kept
    expect(ids).toContain("a1");
    expect(ids).not.toContain("a2");
    expect(top3).toHaveLength(3);
  });

  it("keeps articles with different text", () => {
    const items = [
      makeItem({ id: "a1", text: "Article one about blockchain", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "b1", text: "Article two about artificial intelligence", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "c1", text: "Article three about quantum computing", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    expect(top3).toHaveLength(3);
  });

  it("fills Top3 from next-best items when duplicates are removed", () => {
    const items = [
      makeItem({ id: "a1", text: "Same article content for testing dedup", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "a2", text: "Same article content for testing dedup", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "a3", text: "Same article content for testing dedup", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
      makeItem({ id: "b1", text: "Unique article number two", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
      makeItem({ id: "c1", text: "Unique article number three", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const ids = top3.map(bi => bi.item.id);
    expect(ids).toContain("a1"); // first of 3 dupes
    expect(ids).toContain("b1"); // next unique
    expect(ids).toContain("c1"); // next unique
    expect(ids).not.toContain("a2");
    expect(ids).not.toContain("a3");
  });
});

// ─── Cross-section dedup: Top3 excluded from Spotlight ───

describe("Cross-section dedup — Top3 vs Spotlight", () => {
  const now = Date.now();

  it("Top3 items are excluded from Topic Spotlight by ID", () => {
    const profile = makeProfile({ ai: 0.8 });
    const items = [
      makeItem({ id: "top1", topics: ["ai"], text: "Top AI article for ranking purposes and testing", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "spot1", topics: ["ai"], text: "Another AI article for spotlight section testing", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);

    const top3Ids = new Set(top3.map(bi => bi.item.id));
    for (const group of spotlight) {
      for (const item of group.items) {
        expect(top3Ids.has(item.id)).toBe(false);
      }
    }
  });

  it("Top3 items with same content key are excluded from Spotlight", () => {
    const profile = makeProfile({ ai: 0.8 });
    // Use high-scoring fillers to fill priority (PRIORITY_COUNT=5), keeping spot items out of Top3
    const fillers = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `fill-${i}`, topics: ["other"], text: `Filler article ${i} unique`, scores: { originality: 20, insight: 20, credibility: 20, composite: 20 } }),
    );
    const items = [
      ...fillers,
      makeItem({ id: "top1", topics: ["ai"], text: "Bitcoin breaks record with major institutional adoption", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      // Same text, different ID — should be excluded from spotlight by content key
      makeItem({ id: "spot-dup", topics: ["ai"], text: "Bitcoin breaks record with major institutional adoption", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
      makeItem({ id: "spot-unique", topics: ["ai"], text: "Entirely different article about AI progress", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
    ];
    const top3 = computeDashboardTop3(items, profile, now);
    // top1 may or may not be in Top3 (affinity boost), but spot-dup/spot-unique should not be
    const spotlight = computeTopicSpotlight(items, profile, top3);

    const spotlightIds = spotlight.flatMap(g => g.items.map(i => i.id));
    // spot-dup has same content key as top1 → excluded from spotlight
    expect(spotlightIds).not.toContain("spot-dup");
    // spot-unique has different content → should appear in spotlight
    expect(spotlightIds).toContain("spot-unique");
  });
});

// ─── Within-topic iterative dedup ───

describe("Within-topic dedup — same article in one topic group", () => {
  const now = Date.now();

  it("prevents duplicate articles within a single topic group", () => {
    const profile = makeProfile({ blockchain: 0.3 });
    const sameText = "Blockchain technology advances rapidly with new consensus mechanisms being developed globally";
    const items = [
      makeItem({ id: "bc1", topics: ["blockchain"], text: sameText, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "bc2", topics: ["blockchain"], text: sameText, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "bc3", topics: ["blockchain"], text: "Unique blockchain article with different content", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];
    // Fillers with composite 20 easily beat blockchain items (score ~9.6 with 0.3 affinity boost)
    const filler = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `filler-${i}`, topics: ["other"], text: `Filler article number ${i} with unique content`, scores: { originality: 20, insight: 20, credibility: 20, composite: 20 } }),
    );
    const allItems = [...filler, ...items];

    const top3 = computeDashboardTop3(allItems, profile, now);
    const spotlight = computeTopicSpotlight(allItems, profile, top3);

    const bcGroup = spotlight.find(g => g.topic === "blockchain");
    expect(bcGroup).toBeDefined();
    const bcIds = bcGroup!.items.map(i => i.id);
    // bc1 and bc2 have the same text → only bc1 should be kept
    expect(bcIds).toContain("bc1");
    expect(bcIds).not.toContain("bc2");
    expect(bcIds).toContain("bc3");
  });

  it("handles all items in a topic being duplicates", () => {
    const profile = makeProfile({ blockchain: 0.3, ai: 0.3 });
    const sameText = "Blockchain technology advances rapidly with new developments in decentralized systems and protocols";
    const items = [
      makeItem({ id: "bc1", topics: ["blockchain"], text: sameText, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "bc2", topics: ["blockchain"], text: sameText, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "ai1", topics: ["ai"], text: "Unique AI article for testing purposes", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];
    // Fillers with composite 20 dominate priority, keeping blockchain/ai items out of Top3
    const filler = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `filler-${i}`, topics: ["other"], text: `Filler ${i} unique text`, scores: { originality: 20, insight: 20, credibility: 20, composite: 20 } }),
    );
    const allItems = [...filler, ...items];

    const top3 = computeDashboardTop3(allItems, profile, now);
    const spotlight = computeTopicSpotlight(allItems, profile, top3);

    const bcGroup = spotlight.find(g => g.topic === "blockchain");
    // Only 1 unique item after dedup → group should have 1 item
    expect(bcGroup).toBeDefined();
    expect(bcGroup!.items).toHaveLength(1);
    expect(bcGroup!.items[0].id).toBe("bc1");
  });
});

// ─── Cross-topic dedup ───

describe("Cross-topic dedup — same article in different topic groups", () => {
  const now = Date.now();

  it("higher-affinity topic claims the item first", () => {
    const profile = makeProfile({ ai: 0.8, blockchain: 0.5 });
    const sharedText = "AI and blockchain convergence creates new possibilities for decentralized intelligence networks";
    const items = [
      makeItem({ id: "shared", topics: ["ai", "blockchain"], text: sharedText, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "ai-only", topics: ["ai"], text: "Pure AI article about machine learning", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
      makeItem({ id: "bc-only", topics: ["blockchain"], text: "Pure blockchain article about consensus", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];
    // Fillers with composite 20 dominate priority, keeping shared/ai/bc items out of Top3
    // "shared" has briefingScore = (8 + (0.8+0.5)*2) * 1.0 = 10.6, so need fillers > 10.6
    const filler = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `filler-${i}`, topics: ["other"], text: `Filler ${i} unique text content`, scores: { originality: 20, insight: 20, credibility: 20, composite: 20 } }),
    );
    const allItems = [...filler, ...items];

    const top3 = computeDashboardTop3(allItems, profile, now);
    const spotlight = computeTopicSpotlight(allItems, profile, top3);

    const aiGroup = spotlight.find(g => g.topic === "ai");
    const bcGroup = spotlight.find(g => g.topic === "blockchain");

    // "shared" item goes to AI group (higher affinity 0.8 > 0.5)
    expect(aiGroup?.items.map(i => i.id)).toContain("shared");
    // "shared" should NOT appear in blockchain group
    expect(bcGroup?.items.map(i => i.id)).not.toContain("shared");
  });
});

// ─── Cascading dedup chain ───

describe("Cascading dedup chain — full pipeline", () => {
  const now = Date.now();

  it("no item appears in more than one section", () => {
    const profile = makeProfile({ ai: 0.8, blockchain: 0.5 });
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({
        id: `item-${i}`,
        topics: i % 2 === 0 ? ["ai"] : ["blockchain"],
        text: `Unique article number ${i} with distinct content text`,
        scores: { originality: 10 - (i * 0.3), insight: 7, credibility: 7, composite: 10 - (i * 0.3) },
        validated: i >= 15,
        validatedAt: i >= 15 ? now - i * 1000 : undefined,
      }),
    );

    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);

    const top3Ids = new Set(top3.map(bi => bi.item.id));
    const spotlightIds = new Set(spotlight.flatMap(g => g.items.map(i => i.id)));

    // Spotlight should not contain any Top3 items
    Array.from(spotlightIds).forEach(id => {
      expect(top3Ids.has(id)).toBe(false);
    });
  });
});

// ─── briefingNowRef pinning — ranking stability ───

describe("Ranking stability — pinned time reference", () => {
  it("same content + same time → identical rankings", () => {
    const profile = makeProfile({ ai: 0.5 });
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({
        id: `s-${i}`,
        text: `Stable test article ${i} with unique content for ranking`,
        scores: { originality: 10 - i, insight: 7, credibility: 7, composite: 10 - i },
        createdAt: Date.now() - i * 3600000,
      }),
    );
    const fixedNow = Date.now();

    const run1 = computeDashboardTop3(items, profile, fixedNow);
    const run2 = computeDashboardTop3(items, profile, fixedNow);

    expect(run1.map(bi => bi.item.id)).toEqual(run2.map(bi => bi.item.id));
    expect(run1.map(bi => bi.briefingScore)).toEqual(run2.map(bi => bi.briefingScore));
  });

  it("different time → potentially different rankings due to recency decay", () => {
    const profile = makeProfile({ ai: 0.5 });
    // Items with very close scores but different ages
    const now = Date.now();
    const items = [
      makeItem({ id: "old", text: "Old article but high composite score", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 }, createdAt: now - 24 * 3600000 }),
      makeItem({ id: "new", text: "New article with slightly lower score", scores: { originality: 7.9, insight: 7.9, credibility: 7.9, composite: 7.9 }, createdAt: now }),
    ];

    const earlyRun = computeDashboardTop3(items, profile, now);
    // 48 hours later, the old item decays more
    const lateRun = computeDashboardTop3(items, profile, now + 48 * 3600000);

    // Verify the ranking could differ (old item decays significantly)
    const earlyFirst = earlyRun[0]?.item.id;
    const lateFirst = lateRun[0]?.item.id;
    // With pinned time, re-running with SAME time gives SAME result
    const pinnedRun = computeDashboardTop3(items, profile, now);
    expect(pinnedRun[0]?.item.id).toBe(earlyFirst);
    // After 48h, the new item may overtake the old one
    expect(lateFirst).toBeDefined();
  });

  it("content array reorder does not change rankings (stable sort)", () => {
    const profile = makeProfile({ ai: 0.5 });
    const now = Date.now();
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({
        id: `r-${i}`,
        text: `Reorder test article ${i} unique content text here`,
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
        createdAt: now - i * 3600000,
      }),
    );

    const forward = computeDashboardTop3(items, profile, now);
    const reversed = computeDashboardTop3([...items].reverse(), profile, now);

    expect(forward.map(bi => bi.item.id)).toEqual(reversed.map(bi => bi.item.id));
  });
});

// ─── Validated section dedup ───

describe("Validated section — excluded from Top3/Spotlight", () => {
  it("validated items never appear in Top3 or Spotlight, only in Validated section", () => {
    const now = Date.now();
    const profile = makeProfile({ ai: 0.8 });
    const fillers = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `fill-${i}`, topics: ["other"], text: `Filler ${i} unique`, scores: { originality: 20, insight: 20, credibility: 20, composite: 20 } }),
    );
    const items = [
      ...fillers,
      // High-scoring validated item → excluded from Top3/Spotlight, only in Validated
      makeItem({ id: "top-validated", topics: ["ai"], text: "Top validated AI article content", scores: { originality: 10, insight: 10, credibility: 10, composite: 10 }, validated: true, validatedAt: now }),
      // Low-scoring validated item → also only in Validated section
      makeItem({ id: "only-validated", topics: ["cooking"], text: "A validated cooking article", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 }, validated: true, validatedAt: now - 1000 }),
    ];

    const top3 = computeDashboardTop3(items, profile, now);
    const spotlight = computeTopicSpotlight(items, profile, top3);

    // Build allShownIds
    const shownIds = new Set(top3.map(bi => bi.item.id));
    for (const g of spotlight) {
      for (const item of g.items) shownIds.add(item.id);
    }

    // Validated items must NOT appear in Top3 or Spotlight
    expect(shownIds.has("top-validated")).toBe(false);
    expect(shownIds.has("only-validated")).toBe(false);

    const validated = computeDashboardValidated(items, shownIds);
    const valIds = validated.map((v: ContentItem) => v.id);
    // Both validated items should appear in the Validated section
    expect(valIds).toContain("top-validated");
    expect(valIds).toContain("only-validated");
  });
});

// ─── Edge cases ───

describe("Dedup edge cases", () => {
  const now = Date.now();
  const profile = makeProfile({ ai: 0.5 });

  it("handles all items being duplicates gracefully", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({
        id: `dup-${i}`,
        text: "Exact same article text repeated many times",
        scores: { originality: 10 - i, insight: 7, credibility: 7, composite: 10 - i },
      }),
    );
    const top3 = computeDashboardTop3(items, profile, now);
    // Only 1 unique content key → only 1 item in Top3
    expect(top3).toHaveLength(1);
    expect(top3[0].item.id).toBe("dup-0"); // highest score
  });

  it("handles items with very similar but not identical text", () => {
    const items = [
      makeItem({ id: "a", text: "Bitcoin reaches new ATH. " + "x".repeat(100), scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "b", text: "Bitcoin reaches new ATH. " + "y".repeat(100), scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
    ];
    // First 120 chars differ (at position 26+) → different keys
    const keyA = contentDedup(items[0]);
    const keyB = contentDedup(items[1]);
    // Only the first 25 chars match, then x vs y → different keys
    expect(keyA).not.toBe(keyB);
    const top3 = computeDashboardTop3(items, profile, now);
    expect(top3).toHaveLength(2);
  });

  it("empty content produces empty results", () => {
    const top3 = computeDashboardTop3([], profile, now);
    expect(top3).toHaveLength(0);
    const spotlight = computeTopicSpotlight([], profile, top3);
    expect(spotlight).toHaveLength(0);
  });

  it("single item content works", () => {
    const items = [makeItem({ id: "solo", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } })];
    const top3 = computeDashboardTop3(items, profile, now);
    expect(top3).toHaveLength(1);
  });
});
