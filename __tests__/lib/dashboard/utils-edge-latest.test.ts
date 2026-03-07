/**
 * Edge case and boundary tests for Latest feed filter pipeline.
 * All tests exercise real code — no mocks.
 */
import {
  applyLatestFilter,
  applyDashboardFilters,
  contentDedup,
  computeDashboardTop3,
  computeTopicSpotlight,
  computeUnreviewedQueue,
  computeDashboardSaved,
  type VerdictFilter,
} from "@/lib/dashboard/utils";
import { deduplicateItems } from "@/contexts/content/dedup";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";

let _counter = 0;
function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const n = _counter++;
  return {
    id: `edge-${n}`,
    owner: "test",
    author: "Author",
    avatar: "A",
    text: `Edge test content ${n} unique text for dedup safety`,
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "ok",
    createdAt: Date.now() - n * 60000,
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["test"],
    ...overrides,
  };
}

// ─── contentDedup edge cases ───

describe("contentDedup — edge cases", () => {
  it("strips punctuation from text", () => {
    const a = makeItem({ text: "Hello, world! This is a test." });
    const b = makeItem({ text: "Hello world This is a test" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("normalizes whitespace (tabs, newlines, multiple spaces)", () => {
    const a = makeItem({ text: "Hello   world\n\tnewline tab" });
    const b = makeItem({ text: "Hello world newline tab" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("truncates to 150 chars after normalization", () => {
    const longText = "word ".repeat(100); // 500 chars
    const key = contentDedup(makeItem({ text: longText }));
    expect(key.length).toBe(150);
  });

  it("very short text produces a short key without error", () => {
    const key = contentDedup(makeItem({ text: "hi" }));
    expect(key).toBe("hi");
  });

  it("empty text produces empty key", () => {
    const key = contentDedup(makeItem({ text: "" }));
    expect(key).toBe("");
  });

  it("punctuation-only text produces empty key", () => {
    const key = contentDedup(makeItem({ text: "...!!!???" }));
    expect(key).toBe("");
  });

  it("preserves numbers in text", () => {
    const key = contentDedup(makeItem({ text: "Bitcoin 123 reaches 456" }));
    expect(key).toContain("123");
    expect(key).toContain("456");
  });

  it("case-insensitive matching", () => {
    const a = makeItem({ text: "HELLO WORLD Test" });
    const b = makeItem({ text: "hello world test" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });

  it("items differing only after 150 chars are treated as duplicates", () => {
    const prefix = "a ".repeat(75); // 150 chars
    const a = makeItem({ text: prefix + "unique-suffix-a" });
    const b = makeItem({ text: prefix + "unique-suffix-b" });
    expect(contentDedup(a)).toBe(contentDedup(b));
  });
});

// ─── applyLatestFilter edge cases ───

describe("applyLatestFilter — edge cases", () => {
  it("items with identical createdAt preserve all items", () => {
    const ts = Date.now();
    const items = [
      makeItem({ id: "same-1", createdAt: ts }),
      makeItem({ id: "same-2", createdAt: ts }),
      makeItem({ id: "same-3", createdAt: ts }),
    ];
    const result = applyLatestFilter(items, "all", "all");
    expect(result).toHaveLength(3);
  });

  it("items with very old timestamps sort correctly", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "ancient", createdAt: 1000 }),
      makeItem({ id: "recent", createdAt: now }),
      makeItem({ id: "middle", createdAt: now / 2 }),
    ];
    const result = applyLatestFilter(items, "all", "all");
    expect(result[0].id).toBe("recent");
    expect(result[result.length - 1].id).toBe("ancient");
  });

  it("items with createdAt=0 sort to the end", () => {
    const items = [
      makeItem({ id: "zero", createdAt: 0 }),
      makeItem({ id: "nonzero", createdAt: 1000 }),
    ];
    const result = applyLatestFilter(items, "all", "all");
    expect(result[0].id).toBe("nonzero");
    expect(result[1].id).toBe("zero");
  });

  it("quality filter excludes slop even when excludeSlop is implicit", () => {
    const items = [
      makeItem({ verdict: "quality" }),
      makeItem({ verdict: "slop" }),
    ];
    const result = applyLatestFilter(items, "quality", "all");
    expect(result).toHaveLength(1);
    expect(result[0].verdict).toBe("quality");
  });

  it("bookmarked filter includes slop items that are bookmarked", () => {
    const items = [
      makeItem({ id: "bk-slop", verdict: "slop" }),
      makeItem({ id: "bk-qual", verdict: "quality" }),
      makeItem({ id: "unbk", verdict: "quality" }),
    ];
    const result = applyLatestFilter(items, "bookmarked", "all", ["bk-slop", "bk-qual"]);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.id)).toContain("bk-slop");
    expect(result.map(c => c.id)).toContain("bk-qual");
  });

  it("validated filter includes slop items that are validated", () => {
    const items = [
      makeItem({ id: "v-slop", verdict: "slop", validated: true }),
      makeItem({ id: "v-qual", verdict: "quality", validated: true }),
      makeItem({ id: "unval", verdict: "quality", validated: false }),
    ];
    const result = applyLatestFilter(items, "validated", "all");
    expect(result).toHaveLength(2);
    expect(result.map(c => c.id)).toContain("v-slop");
  });

  it("combining source filter with verdict filter narrows correctly", () => {
    const items = [
      makeItem({ id: "rss-q", source: "rss", verdict: "quality" }),
      makeItem({ id: "rss-s", source: "rss", verdict: "slop" }),
      makeItem({ id: "nostr-q", source: "nostr", verdict: "quality" }),
    ];
    // "all" verdict with "rss" source — excludes slop + filters source
    const result = applyLatestFilter(items, "all", "rss");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rss-q");
  });

  it("nonexistent source returns empty", () => {
    const items = [makeItem({ source: "rss" })];
    const result = applyLatestFilter(items, "all", "nonexistent");
    expect(result).toEqual([]);
  });

  it("all verdict filters are exhaustive", () => {
    const filters: VerdictFilter[] = ["all", "quality", "slop", "validated", "bookmarked"];
    const items = [
      makeItem({ verdict: "quality", validated: true }),
      makeItem({ verdict: "slop" }),
    ];
    for (const f of filters) {
      expect(() => applyLatestFilter(items, f, "all")).not.toThrow();
    }
  });
});

// ─── Filter + dedup pipeline ───

describe("applyLatestFilter + deduplicateItems pipeline", () => {
  it("dedup preserves chronological sort order", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "new", text: "Unique new article", createdAt: now }),
      makeItem({ id: "dup", text: "Duplicate article text", createdAt: now - 1000 }),
      makeItem({ id: "dup2", text: "Duplicate article text", createdAt: now - 2000 }),
      makeItem({ id: "old", text: "Unique old article", createdAt: now - 3000 }),
    ];
    const sorted = applyLatestFilter(items, "all", "all");
    const deduped = deduplicateItems(sorted);

    expect(deduped).toHaveLength(3);
    // Order should still be newest first
    expect(deduped[0].id).toBe("new");
    expect(deduped[1].id).toBe("dup"); // first occurrence (newer)
    expect(deduped[2].id).toBe("old");
  });

  it("dedup with URL duplicates keeps newer item", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "old-url", text: "Old version", sourceUrl: "https://example.com/article", createdAt: now - 5000 }),
      makeItem({ id: "new-url", text: "New version", sourceUrl: "https://www.example.com/article?utm_source=twitter", createdAt: now }),
    ];
    const sorted = applyLatestFilter(items, "all", "all");
    const deduped = deduplicateItems(sorted);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("new-url");
  });

  it("bookmarked filter + dedup does not remove bookmarked duplicates incorrectly", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "bk1", text: "Bookmarked article", createdAt: now }),
      makeItem({ id: "bk2", text: "Different article", createdAt: now - 1000 }),
    ];
    const sorted = applyLatestFilter(items, "bookmarked", "all", ["bk1", "bk2"]);
    const deduped = deduplicateItems(sorted);

    expect(deduped).toHaveLength(2);
  });

  it("bookmarked duplicate: only one survives dedup", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "bk-new", text: "Same article text", createdAt: now }),
      makeItem({ id: "bk-old", text: "Same article text", createdAt: now - 1000 }),
    ];
    const sorted = applyLatestFilter(items, "bookmarked", "all", ["bk-new", "bk-old"]);
    const deduped = deduplicateItems(sorted);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("bk-new"); // newer survives
  });

  it("empty input produces empty output through the pipeline", () => {
    const result = deduplicateItems(applyLatestFilter([], "all", "all"));
    expect(result).toEqual([]);
  });

  it("single item passes through pipeline unchanged", () => {
    const item = makeItem({ id: "solo" });
    const result = deduplicateItems(applyLatestFilter([item], "all", "all"));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("solo");
  });

  it("1000 items: pipeline completes without error", () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      makeItem({ id: `bulk-${i}`, text: `Bulk article ${i}`, createdAt: Date.now() - i * 1000 }),
    );
    const result = deduplicateItems(applyLatestFilter(items, "all", "all"));
    expect(result).toHaveLength(1000);
    // Verify still sorted
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].createdAt).toBeGreaterThanOrEqual(result[i].createdAt);
    }
  });
});

// ─── applyDashboardFilters validated sort edge cases ───

describe("applyDashboardFilters — validated sort edge cases", () => {
  it("validated items with undefined validatedAt sort to end (fallback to 0)", () => {
    const items = [
      makeItem({ id: "v-undef", validated: true }),
      makeItem({ id: "v-set", validated: true, validatedAt: 5000 }),
    ];
    const result = applyDashboardFilters(items, "validated", "all");
    expect(result[0].id).toBe("v-set");
    expect(result[1].id).toBe("v-undef");
  });

  it("non-validated filters do not sort", () => {
    const items = [
      makeItem({ id: "a", createdAt: 100 }),
      makeItem({ id: "b", createdAt: 300 }),
      makeItem({ id: "c", createdAt: 200 }),
    ];
    const result = applyDashboardFilters(items, "all", "all");
    // Should preserve original order (no sort applied)
    expect(result.map(c => c.id)).toEqual(["a", "b", "c"]);
  });
});

// ─── computeUnreviewedQueue dedup ───

describe("computeUnreviewedQueue — dedup via contentDedup", () => {
  it("deduplicates items with similar text in queue", () => {
    const items = [
      makeItem({ id: "q1", text: "Bitcoin price reaches new all time high today", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "q2", text: "Bitcoin price reaches new all time high today!", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "q3", text: "Ethereum update released", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    ];
    const result = computeUnreviewedQueue(items, new Set());
    // q1 and q2 have same contentDedup key (punctuation stripped) → only q1 (higher composite) kept
    expect(result.map(c => c.id)).toContain("q1");
    expect(result.map(c => c.id)).not.toContain("q2");
    expect(result.map(c => c.id)).toContain("q3");
  });

  it("excludes validated and flagged items", () => {
    const items = [
      makeItem({ id: "val", validated: true }),
      makeItem({ id: "flag", flagged: true }),
      makeItem({ id: "fresh", validated: false, flagged: false }),
    ];
    const result = computeUnreviewedQueue(items, new Set());
    expect(result.map(c => c.id)).toEqual(["fresh"]);
  });

  it("excludes items in excludeIds set", () => {
    const items = [makeItem({ id: "excl" }), makeItem({ id: "incl" })];
    const result = computeUnreviewedQueue(items, new Set(["excl"]));
    expect(result.map(c => c.id)).toEqual(["incl"]);
  });

  it("caps at 5 items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `cap-${i}`, text: `Unique article ${i} for queue` }),
    );
    const result = computeUnreviewedQueue(items, new Set());
    expect(result).toHaveLength(5);
  });
});

// ─── computeDashboardSaved ───

describe("computeDashboardSaved — edge cases", () => {
  it("only includes bookmarked, non-validated, non-flagged items", () => {
    const items = [
      makeItem({ id: "bk-ok", validated: false, flagged: false }),
      makeItem({ id: "bk-val", validated: true, flagged: false }),
      makeItem({ id: "bk-flag", validated: false, flagged: true }),
      makeItem({ id: "unbk", validated: false, flagged: false }),
    ];
    const result = computeDashboardSaved(items, ["bk-ok", "bk-val", "bk-flag"], new Set());
    expect(result.map(c => c.id)).toEqual(["bk-ok"]);
  });

  it("excludes items in excludeIds", () => {
    const items = [makeItem({ id: "s1" }), makeItem({ id: "s2" })];
    const result = computeDashboardSaved(items, ["s1", "s2"], new Set(["s1"]));
    expect(result.map(c => c.id)).toEqual(["s2"]);
  });

  it("sorts by composite descending", () => {
    const items = [
      makeItem({ id: "lo", scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } }),
      makeItem({ id: "hi", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    ];
    const result = computeDashboardSaved(items, ["lo", "hi"], new Set());
    expect(result[0].id).toBe("hi");
  });

  it("caps at 5 items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `sv-${i}`, text: `Saved ${i}` }),
    );
    const result = computeDashboardSaved(items, items.map(c => c.id), new Set());
    expect(result).toHaveLength(5);
  });

  it("empty bookmarkedIds returns empty", () => {
    const items = [makeItem()];
    const result = computeDashboardSaved(items, [], new Set());
    expect(result).toEqual([]);
  });
});

// ─── computeDashboardTop3 + computeTopicSpotlight cascading dedup ───

describe("Top3 + Spotlight — cascading dedup", () => {
  const profile = {
    ...createEmptyProfile("test"),
    topicAffinities: { ai: 0.8, crypto: 0.6 },
  };
  const now = Date.now();

  it("spotlight excludes items already in Top3", () => {
    // Create items where some will land in Top3, then check spotlight
    const items = [
      makeItem({ id: "t1", text: "AI article one unique", topics: ["ai"], scores: { originality: 10, insight: 10, credibility: 10, composite: 10 }, createdAt: now }),
      makeItem({ id: "t2", text: "AI article two unique", topics: ["ai"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 }, createdAt: now - 1000 }),
      makeItem({ id: "t3", text: "Crypto article unique", topics: ["crypto"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8 }, createdAt: now - 2000 }),
      makeItem({ id: "s1", text: "AI spotlight candidate unique", topics: ["ai"], scores: { originality: 5, insight: 5, credibility: 5, composite: 5 }, createdAt: now - 3000 }),
    ];

    const top3 = computeDashboardTop3(items, profile, now);
    const top3Ids = new Set(top3.map(bi => bi.item.id));

    const spotlight = computeTopicSpotlight(items, profile, top3);
    const spotlightIds = spotlight.flatMap(g => g.items.map(c => c.id));

    // No overlap between Top3 and Spotlight
    for (const id of spotlightIds) {
      expect(top3Ids.has(id)).toBe(false);
    }
  });

  it("spotlight returns empty when no high-affinity topics", () => {
    const lowProfile = { ...createEmptyProfile("test"), topicAffinities: { ai: 0.1 } };
    const items = [makeItem({ topics: ["ai"] })];
    const top3 = computeDashboardTop3(items, lowProfile, now);
    const spotlight = computeTopicSpotlight(items, lowProfile, top3);
    expect(spotlight).toHaveLength(0);
  });
});
