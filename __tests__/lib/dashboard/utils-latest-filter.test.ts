/**
 * Tests for applyLatestFilter and applyDashboardFilters with bookmarked support.
 * Exercises real filter logic — no mocks.
 */
import { applyLatestFilter, applyDashboardFilters } from "@/lib/dashboard/utils";
import type { ContentItem } from "@/lib/types/content";

let _counter = 0;
function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const n = _counter++;
  return {
    id: `lt-${n}`,
    owner: "test",
    author: "Author",
    avatar: "A",
    text: `Content ${n}`,
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "ok",
    createdAt: Date.now() - n * 60000, // each item 1 min older
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["ai"],
    ...overrides,
  };
}

describe("applyLatestFilter", () => {
  it("excludes slop items with 'all' verdictFilter", () => {
    const items = [
      makeItem({ id: "q1", verdict: "quality" }),
      makeItem({ id: "s1", verdict: "slop" }),
      makeItem({ id: "q2", verdict: "quality" }),
    ];
    const result = applyLatestFilter(items, "all", "all");
    expect(result.map(c => c.id)).toEqual(expect.arrayContaining(["q1", "q2"]));
    expect(result.map(c => c.id)).not.toContain("s1");
  });

  it("excludes slop items with 'quality' verdictFilter", () => {
    const items = [
      makeItem({ verdict: "quality" }),
      makeItem({ verdict: "slop" }),
    ];
    const result = applyLatestFilter(items, "quality", "all");
    expect(result).toHaveLength(1);
    expect(result[0].verdict).toBe("quality");
  });

  it("shows only slop items with 'slop' verdictFilter", () => {
    const items = [
      makeItem({ id: "q1", verdict: "quality" }),
      makeItem({ id: "s1", verdict: "slop" }),
      makeItem({ id: "s2", verdict: "slop" }),
    ];
    const result = applyLatestFilter(items, "slop", "all");
    expect(result).toHaveLength(2);
    expect(result.every(c => c.verdict === "slop")).toBe(true);
  });

  it("shows only validated items with 'validated' verdictFilter", () => {
    const items = [
      makeItem({ id: "v1", validated: true }),
      makeItem({ id: "v2", validated: false }),
      makeItem({ id: "v3", validated: true }),
    ];
    const result = applyLatestFilter(items, "validated", "all");
    expect(result).toHaveLength(2);
    expect(result.every(c => c.validated)).toBe(true);
  });

  it("shows only bookmarked items with 'bookmarked' verdictFilter", () => {
    const items = [
      makeItem({ id: "b1" }),
      makeItem({ id: "b2" }),
      makeItem({ id: "b3" }),
    ];
    const result = applyLatestFilter(items, "bookmarked", "all", ["b1", "b3"]);
    expect(result.map(c => c.id)).toEqual(expect.arrayContaining(["b1", "b3"]));
    expect(result).toHaveLength(2);
  });

  it("sorts by createdAt descending (newest first)", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "old", createdAt: now - 3000 }),
      makeItem({ id: "new", createdAt: now }),
      makeItem({ id: "mid", createdAt: now - 1000 }),
    ];
    const result = applyLatestFilter(items, "all", "all");
    expect(result.map(c => c.id)).toEqual(["new", "mid", "old"]);
  });

  it("applies source filter", () => {
    const items = [
      makeItem({ id: "r1", source: "rss" }),
      makeItem({ id: "n1", source: "nostr" }),
      makeItem({ id: "r2", source: "rss" }),
    ];
    const result = applyLatestFilter(items, "all", "rss");
    expect(result).toHaveLength(2);
    expect(result.every(c => c.source === "rss")).toBe(true);
  });

  it("combines verdict and source filters", () => {
    const items = [
      makeItem({ id: "qr", verdict: "quality", source: "rss" }),
      makeItem({ id: "qn", verdict: "quality", source: "nostr" }),
      makeItem({ id: "sr", verdict: "slop", source: "rss" }),
    ];
    const result = applyLatestFilter(items, "all", "rss");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("qr");
  });

  it("returns empty array for empty input", () => {
    expect(applyLatestFilter([], "all", "all")).toEqual([]);
  });

  it("returns empty when no items match filters", () => {
    const items = [makeItem({ verdict: "slop" })];
    const result = applyLatestFilter(items, "all", "all");
    expect(result).toEqual([]);
  });

  it("bookmarked filter includes slop items if bookmarked", () => {
    const items = [
      makeItem({ id: "bs1", verdict: "slop" }),
      makeItem({ id: "bq1", verdict: "quality" }),
    ];
    const result = applyLatestFilter(items, "bookmarked", "all", ["bs1"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("bs1");
  });

  it("validated filter includes slop items if validated", () => {
    const items = [
      makeItem({ id: "vs1", verdict: "slop", validated: true }),
      makeItem({ id: "vq1", verdict: "quality", validated: false }),
    ];
    const result = applyLatestFilter(items, "validated", "all");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("vs1");
  });

  it("does not mutate input array", () => {
    const items = [
      makeItem({ createdAt: 100 }),
      makeItem({ createdAt: 300 }),
      makeItem({ createdAt: 200 }),
    ];
    const originalOrder = items.map(c => c.id);
    applyLatestFilter(items, "all", "all");
    expect(items.map(c => c.id)).toEqual(originalOrder);
  });

  it("handles items with identical createdAt — preserves all items", () => {
    const ts = Date.now();
    const items = [
      makeItem({ id: "a", createdAt: ts }),
      makeItem({ id: "b", createdAt: ts }),
      makeItem({ id: "c", createdAt: ts }),
    ];
    const result = applyLatestFilter(items, "all", "all");
    expect(result).toHaveLength(3);
    const ids = new Set(result.map(c => c.id));
    expect(ids).toEqual(new Set(["a", "b", "c"]));
  });

  it("validated filter maintains createdAt sort (not validatedAt)", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "v-old-created-but-recently-validated", createdAt: now - 5000, validated: true, validatedAt: now }),
      makeItem({ id: "v-new-created-but-early-validated", createdAt: now, validated: true, validatedAt: now - 5000 }),
    ];
    const result = applyLatestFilter(items, "validated", "all");
    // Latest mode sorts by createdAt, NOT validatedAt
    expect(result[0].id).toBe("v-new-created-but-early-validated");
    expect(result[1].id).toBe("v-old-created-but-recently-validated");
  });

  it("bookmarkedIds defaults to empty array", () => {
    const items = [makeItem({ id: "x1" })];
    const result = applyLatestFilter(items, "bookmarked", "all");
    expect(result).toEqual([]);
  });

  it("source filter 'all' returns all sources", () => {
    const items = [
      makeItem({ source: "rss" }),
      makeItem({ source: "nostr" }),
      makeItem({ source: "manual" }),
      makeItem({ source: "twitter" }),
      makeItem({ source: "farcaster" }),
      makeItem({ source: "url" }),
    ];
    const result = applyLatestFilter(items, "all", "all");
    expect(result).toHaveLength(6);
  });
});

describe("applyDashboardFilters with bookmarked", () => {
  it("filters by bookmarked IDs", () => {
    const items = [
      makeItem({ id: "d1" }),
      makeItem({ id: "d2" }),
      makeItem({ id: "d3" }),
    ];
    const result = applyDashboardFilters(items, "bookmarked", "all", ["d2"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("d2");
  });

  it("bookmarked filter with source filter", () => {
    const items = [
      makeItem({ id: "br1", source: "rss" }),
      makeItem({ id: "bn1", source: "nostr" }),
    ];
    const result = applyDashboardFilters(items, "bookmarked", "rss", ["br1", "bn1"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("br1");
  });

  it("all filter does NOT exclude slop (unlike Latest)", () => {
    const items = [
      makeItem({ verdict: "quality" }),
      makeItem({ verdict: "slop" }),
    ];
    const result = applyDashboardFilters(items, "all", "all");
    expect(result).toHaveLength(2);
  });

  it("validated filter sorts by validatedAt descending", () => {
    const items = [
      makeItem({ id: "va", validated: true, validatedAt: 1000 }),
      makeItem({ id: "vb", validated: true, validatedAt: 3000 }),
      makeItem({ id: "vc", validated: true, validatedAt: 2000 }),
    ];
    const result = applyDashboardFilters(items, "validated", "all");
    expect(result.map(c => c.id)).toEqual(["vb", "vc", "va"]);
  });

  it("works without bookmarkedIds argument (default [])", () => {
    const items = [makeItem({ verdict: "quality" })];
    const result = applyDashboardFilters(items, "all", "all");
    expect(result).toHaveLength(1);
  });
});

describe("applyLatestFilter vs applyDashboardFilters — behavioral contrast", () => {
  it("'all' filter: Latest excludes slop, Dashboard includes slop", () => {
    const items = [
      makeItem({ id: "cq", verdict: "quality" }),
      makeItem({ id: "cs", verdict: "slop" }),
    ];
    const latest = applyLatestFilter(items, "all", "all");
    const dashboard = applyDashboardFilters(items, "all", "all");
    expect(latest.map(c => c.id)).toEqual(["cq"]);
    expect(dashboard.map(c => c.id)).toEqual(expect.arrayContaining(["cq", "cs"]));
    expect(dashboard).toHaveLength(2);
  });

  it("validated: Latest sorts by createdAt, Dashboard sorts by validatedAt", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "a", createdAt: now, validated: true, validatedAt: now - 2000 }),
      makeItem({ id: "b", createdAt: now - 2000, validated: true, validatedAt: now }),
    ];
    const latest = applyLatestFilter(items, "validated", "all");
    const dashboard = applyDashboardFilters(items, "validated", "all");
    // Latest: by createdAt desc → a first
    expect(latest[0].id).toBe("a");
    // Dashboard: by validatedAt desc → b first
    expect(dashboard[0].id).toBe("b");
  });
});

describe("applyLatestFilter + deduplicateItems integration", () => {
  // Import the real deduplicateItems to test the full pipeline
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deduplicateItems } = require("@/contexts/content/dedup");

  it("dedup after Latest sort keeps newer duplicate", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "dup-old", text: "Duplicate content text", createdAt: now - 5000 }),
      makeItem({ id: "dup-new", text: "Duplicate content text", createdAt: now }),
    ];
    const sorted = applyLatestFilter(items, "all", "all");
    // Latest sorts newest first
    expect(sorted[0].id).toBe("dup-new");
    // dedup keeps first occurrence → newer one survives
    const deduped = deduplicateItems(sorted);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("dup-new");
  });

  it("dedup after Latest sort with URL duplicates keeps newer", () => {
    const now = Date.now();
    const items = [
      makeItem({ id: "url-old", text: "Old text", sourceUrl: "https://example.com/article", createdAt: now - 5000 }),
      makeItem({ id: "url-new", text: "New text", sourceUrl: "https://www.example.com/article?utm_source=twitter", createdAt: now }),
    ];
    const sorted = applyLatestFilter(items, "all", "all");
    const deduped = deduplicateItems(sorted);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("url-new");
  });
});
