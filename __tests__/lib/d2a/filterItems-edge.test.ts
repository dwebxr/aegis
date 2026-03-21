/**
 * Edge-case and boundary tests for filterItems module.
 * Covers: non-numeric params, boundary offsets, empty inputs,
 * unicode hashing, exact-length truncation, combined filters.
 */
import {
  parseFilterParams,
  filterAndPaginate,
  truncateForPreview,
  itemHash,
} from "@/lib/d2a/filterItems";
import type { D2ABriefingItem, D2ABriefingResponse } from "@/lib/d2a/types";

function makeItem(overrides: Partial<D2ABriefingItem> = {}): D2ABriefingItem {
  return {
    title: "Article",
    content: "Content body text here.",
    source: "rss",
    sourceUrl: "https://example.com/article",
    scores: { originality: 7, insight: 8, credibility: 9, composite: 8 },
    verdict: "quality",
    reason: "Good",
    topics: ["AI"],
    briefingScore: 0.85,
    ...overrides,
  };
}

function makeBriefing(
  items: D2ABriefingItem[],
  overrides: Partial<D2ABriefingResponse> = {},
): D2ABriefingResponse {
  return {
    version: "1.0",
    generatedAt: "2026-03-20T12:00:00.000Z",
    source: "aegis",
    sourceUrl: "https://aegis.dwebxr.xyz",
    summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
    items,
    serendipityPick: null,
    meta: { scoringModel: "vcl-v1", nostrPubkey: null, topics: ["AI"] },
    ...overrides,
  };
}

// ── parseFilterParams edge cases ──────────────────────────────────

describe("parseFilterParams — edge cases", () => {
  it("returns default limit=50 for non-numeric limit string", () => {
    const p = parseFilterParams(new URLSearchParams("limit=abc"));
    expect(p.limit).toBe(50);
  });

  it("returns default offset=0 for non-numeric offset string", () => {
    const p = parseFilterParams(new URLSearchParams("offset=xyz"));
    expect(p.offset).toBe(0);
  });

  it("handles negative limit by clamping to 1", () => {
    const p = parseFilterParams(new URLSearchParams("limit=-10"));
    expect(p.limit).toBe(1);
  });

  it("parses limit=1 exactly", () => {
    const p = parseFilterParams(new URLSearchParams("limit=1"));
    expect(p.limit).toBe(1);
  });

  it("parses limit=100 exactly (boundary max)", () => {
    const p = parseFilterParams(new URLSearchParams("limit=100"));
    expect(p.limit).toBe(100);
  });

  it("clamps limit=101 to 100", () => {
    const p = parseFilterParams(new URLSearchParams("limit=101"));
    expect(p.limit).toBe(100);
  });

  it("treats limit with decimal by parseInt truncation", () => {
    const p = parseFilterParams(new URLSearchParams("limit=7.9"));
    expect(p.limit).toBe(7);
  });

  it("handles topics with only commas and spaces as undefined-like", () => {
    const p = parseFilterParams(new URLSearchParams("topics=,,,  , ,"));
    // All entries are empty after trim+filter
    expect(p.topics).toEqual([]);
  });

  it("handles single topic without comma", () => {
    const p = parseFilterParams(new URLSearchParams("topics=DeFi"));
    expect(p.topics).toEqual(["defi"]);
  });

  it("handles topics with extra whitespace", () => {
    const p = parseFilterParams(new URLSearchParams("topics= AI , DeFi , Crypto "));
    expect(p.topics).toEqual(["ai", "defi", "crypto"]);
  });

  it("handles since as Unix timestamp string (invalid ISO 8601 — depends on Date)", () => {
    // new Date("1679000000000") → Invalid Date (it's not a valid date string)
    const p = parseFilterParams(new URLSearchParams("since=1679000000000"));
    // This is actually a valid year 1679000000000 in some engines or Invalid Date
    // The important thing is it doesn't throw
    expect(p.since === undefined || typeof p.since === "string").toBe(true);
  });

  it("handles since with date-only format (no time)", () => {
    const p = parseFilterParams(new URLSearchParams("since=2026-03-20"));
    expect(p.since).toBeDefined();
    // Should parse to midnight UTC
    expect(p.since).toContain("2026-03-20");
  });

  it("ignores empty since string", () => {
    const p = parseFilterParams(new URLSearchParams("since="));
    expect(p.since).toBeUndefined();
  });

  it("handles offset=0 explicitly (not treated as NaN)", () => {
    const p = parseFilterParams(new URLSearchParams("offset=0"));
    expect(p.offset).toBe(0);
  });

  it("handles very large offset", () => {
    const p = parseFilterParams(new URLSearchParams("offset=999999"));
    expect(p.offset).toBe(999999);
  });
});

// ── filterAndPaginate edge cases ──────────────────────────────────

describe("filterAndPaginate — edge cases", () => {
  it("handles empty items array", () => {
    const briefing = makeBriefing([]);
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0 });
    expect(result.items).toHaveLength(0);
    expect(result.pagination).toEqual({ offset: 0, limit: 50, total: 0, hasMore: false });
  });

  it("returns empty items when offset exceeds total", () => {
    const briefing = makeBriefing([makeItem(), makeItem()]);
    const result = filterAndPaginate(briefing, { limit: 10, offset: 100 });
    expect(result.items).toHaveLength(0);
    expect(result.pagination.total).toBe(2);
    expect(result.pagination.hasMore).toBe(false);
  });

  it("returns correct hasMore when offset + limit equals total exactly", () => {
    const items = Array.from({ length: 5 }, () => makeItem());
    const briefing = makeBriefing(items);
    const result = filterAndPaginate(briefing, { limit: 5, offset: 0 });
    expect(result.items).toHaveLength(5);
    expect(result.pagination.hasMore).toBe(false);
  });

  it("returns hasMore=true when offset + limit = total - 1", () => {
    const items = Array.from({ length: 6 }, () => makeItem());
    const briefing = makeBriefing(items);
    const result = filterAndPaginate(briefing, { limit: 5, offset: 0 });
    expect(result.pagination.hasMore).toBe(true);
  });

  it("since filter at exact boundary (same timestamp) keeps items", () => {
    // since < briefingTs should keep, since == briefingTs should also keep (not <)
    const briefing = makeBriefing([makeItem()], { generatedAt: "2026-03-20T12:00:00.000Z" });
    const result = filterAndPaginate(briefing, {
      limit: 50,
      offset: 0,
      since: "2026-03-20T12:00:00.000Z",
    });
    // briefingTs (12:00) < sinceTs (12:00) is false, so items are kept
    expect(result.items).toHaveLength(1);
  });

  it("since filter 1ms after briefing excludes all items", () => {
    const briefing = makeBriefing([makeItem()], { generatedAt: "2026-03-20T12:00:00.000Z" });
    const result = filterAndPaginate(briefing, {
      limit: 50,
      offset: 0,
      since: "2026-03-20T12:00:00.001Z",
    });
    expect(result.items).toHaveLength(0);
  });

  it("topic filter with no matching items returns empty", () => {
    const briefing = makeBriefing([
      makeItem({ topics: ["AI"] }),
      makeItem({ topics: ["DeFi"] }),
    ]);
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0, topics: ["gaming"] });
    expect(result.items).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });

  it("topic filter is case-insensitive on item topics", () => {
    const briefing = makeBriefing([
      makeItem({ topics: ["MachineLearning"] }),
    ]);
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0, topics: ["machinelearning"] });
    expect(result.items).toHaveLength(1);
  });

  it("empty topics array in params does not filter (treated as no filter)", () => {
    const briefing = makeBriefing([makeItem(), makeItem()]);
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0, topics: [] });
    expect(result.items).toHaveLength(2);
  });

  it("preserves serendipityPick when non-null", () => {
    const pick = makeItem({ title: "Serendipity Pick" });
    const briefing = makeBriefing([makeItem()], { serendipityPick: pick });
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0 });
    expect(result.serendipityPick).not.toBeNull();
    expect(result.serendipityPick!.title).toBe("Serendipity Pick");
  });

  it("topic filter + since filter + pagination combined", () => {
    const items = [
      makeItem({ title: "AI 1", topics: ["AI"] }),
      makeItem({ title: "AI 2", topics: ["AI"] }),
      makeItem({ title: "AI 3", topics: ["AI"] }),
      makeItem({ title: "DeFi 1", topics: ["DeFi"] }),
    ];
    // Briefing generated in the future, so since won't exclude it
    const briefing = makeBriefing(items, { generatedAt: "2026-03-21T00:00:00Z" });
    const result = filterAndPaginate(briefing, {
      limit: 2,
      offset: 1,
      topics: ["ai"],
      since: "2026-03-20T00:00:00Z",
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe("AI 2");
    expect(result.pagination.total).toBe(3);
    expect(result.pagination.hasMore).toBe(false);
  });

  it("does not mutate original briefing items array", () => {
    const original = [makeItem({ title: "A" }), makeItem({ title: "B" })];
    const briefing = makeBriefing(original);
    filterAndPaginate(briefing, { limit: 1, offset: 0 });
    expect(briefing.items).toHaveLength(2);
  });
});

// ── truncateForPreview edge cases ─────────────────────────────────

describe("truncateForPreview — edge cases", () => {
  it("handles empty items array", () => {
    expect(truncateForPreview([])).toEqual([]);
  });

  it("content exactly at maxLength is NOT truncated", () => {
    const content = "X".repeat(200);
    const result = truncateForPreview([makeItem({ content })], 200);
    expect(result[0].content).toBe(content);
    expect(result[0].content.length).toBe(200);
  });

  it("content at maxLength + 1 IS truncated", () => {
    const content = "X".repeat(201);
    const result = truncateForPreview([makeItem({ content })], 200);
    expect(result[0].content).toBe("X".repeat(200) + "...");
  });

  it("handles empty content string", () => {
    const result = truncateForPreview([makeItem({ content: "" })], 200);
    expect(result[0].content).toBe("");
  });

  it("preserves all non-content fields", () => {
    const item = makeItem({ title: "Keep Me", content: "A".repeat(300), topics: ["test"] });
    const result = truncateForPreview([item], 200);
    expect(result[0].title).toBe("Keep Me");
    expect(result[0].topics).toEqual(["test"]);
    expect(result[0].scores.composite).toBe(8);
  });

  it("handles multiple items, truncating only long ones", () => {
    const items = [
      makeItem({ content: "Short" }),
      makeItem({ content: "X".repeat(300) }),
      makeItem({ content: "Y".repeat(200) }),
    ];
    const result = truncateForPreview(items);
    expect(result[0].content).toBe("Short");
    expect(result[1].content).toBe("X".repeat(200) + "...");
    expect(result[2].content).toBe("Y".repeat(200)); // exactly 200, not truncated
  });

  it("custom maxLength of 0 truncates everything with content", () => {
    const result = truncateForPreview([makeItem({ content: "hello" })], 0);
    expect(result[0].content).toBe("...");
  });
});

// ── itemHash edge cases ───────────────────────────────────────────

describe("itemHash — edge cases", () => {
  it("handles empty title and URL", () => {
    const hash = itemHash("", "");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("distinguishes title-only difference", () => {
    const a = itemHash("Title A", "https://example.com");
    const b = itemHash("Title B", "https://example.com");
    expect(a).not.toBe(b);
  });

  it("distinguishes URL-only difference", () => {
    const a = itemHash("Same Title", "https://a.com");
    const b = itemHash("Same Title", "https://b.com");
    expect(a).not.toBe(b);
  });

  it("handles unicode in title", () => {
    const hash = itemHash("日本語タイトル 🎉", "https://example.com");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("handles very long inputs", () => {
    const longTitle = "A".repeat(10_000);
    const longUrl = "https://example.com/" + "b".repeat(10_000);
    const hash = itemHash(longTitle, longUrl);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash.length).toBe(64);
  });

  it("null byte separator prevents title/url collision", () => {
    // "a\0b" vs "a\0" + "b" should be the same
    // but "ab\0" vs "a\0b" should differ
    const h1 = itemHash("a", "b");   // hash of "a\0b"
    const h2 = itemHash("a\0b", ""); // hash of "a\0b\0"
    expect(h1).not.toBe(h2);
  });
});
