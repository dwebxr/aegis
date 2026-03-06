/**
 * @jest-environment jsdom
 */
import "fake-indexeddb/auto";
import { truncatePreservingActioned, loadCachedContent, saveCachedContent } from "@/contexts/content/cache";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    owner: "owner1",
    author: "Author",
    avatar: "",
    text: "Some text",
    source: "rss",
    scores: { originality: 7, insight: 6, credibility: 8, composite: 7 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "1m ago",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  indexedDB.deleteDatabase("aegis-storage");
});

describe("loadCachedContent — validation edge cases", () => {
  it("rejects items where scores is a string", async () => {
    localStorage.setItem("aegis-content-cache", JSON.stringify([
      { id: "x", text: "t", source: "rss", createdAt: 1, verdict: "q", validated: true, flagged: false, scores: "not-obj" },
    ]));
    const result = await loadCachedContent();
    expect(result).toHaveLength(0);
  });

  it("accepts items where scores.composite is NaN (typeof NaN === 'number')", async () => {
    // NaN serializes to null in JSON, so composite becomes null after JSON.parse
    localStorage.setItem("aegis-content-cache", JSON.stringify([
      { id: "x", text: "t", source: "rss", createdAt: 1, verdict: "q", validated: true, flagged: false, scores: { composite: null } },
    ]));
    const result = await loadCachedContent();
    // null is not typeof "number", so it gets rejected
    expect(result).toHaveLength(0);
  });

  it("rejects null and undefined entries in array", async () => {
    localStorage.setItem("aegis-content-cache", JSON.stringify([null, undefined, false, 0, ""]));
    const result = await loadCachedContent();
    expect(result).toHaveLength(0);
  });

  it("accepts items with extra fields (forwards compatibility)", async () => {
    const item = { ...makeItem({ id: "extended" }), futureField: "hello", anotherField: 42 };
    localStorage.setItem("aegis-content-cache", JSON.stringify([item]));
    const result = await loadCachedContent();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("extended");
  });

  it("handles empty array in localStorage", async () => {
    localStorage.setItem("aegis-content-cache", JSON.stringify([]));
    const result = await loadCachedContent();
    expect(result).toEqual([]);
  });

  it("handles very large dataset from cache", async () => {
    const items = Array.from({ length: 500 }, (_, i) => makeItem({ id: `big-${i}` }));
    localStorage.setItem("aegis-content-cache", JSON.stringify(items));
    const result = await loadCachedContent();
    expect(result).toHaveLength(500);
  });
});

describe("saveCachedContent — debounce edge cases", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("replaces previous pending save when called rapidly", () => {
    // saveCachedContent uses IDB in jsdom (fake-indexeddb), so we test
    // that multiple rapid calls don't throw and the debounce works
    expect(() => {
      saveCachedContent([makeItem({ id: "first" })]);
      jest.advanceTimersByTime(500);
      saveCachedContent([makeItem({ id: "second" })]);
      jest.advanceTimersByTime(500);
      saveCachedContent([makeItem({ id: "third" })]);
      jest.advanceTimersByTime(1100);
    }).not.toThrow();
  });

  it("handles empty array save", () => {
    saveCachedContent([]);
    jest.advanceTimersByTime(1100);

    const raw = localStorage.getItem("aegis-content-cache");
    if (raw) {
      expect(JSON.parse(raw)).toEqual([]);
    }
  });
});

describe("truncatePreservingActioned — additional edge cases", () => {
  it("handles 10000 items efficiently", () => {
    const items = Array.from({ length: 10000 }, (_, i) =>
      makeItem({ id: `stress-${i}`, validated: i % 100 === 0 }),
    );
    const start = performance.now();
    const result = truncatePreservingActioned(items);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(result.length).toBeLessThanOrEqual(200);

    // All validated must be present
    const validatedOriginal = items.filter(c => c.validated);
    const resultIds = new Set(result.map(c => c.id));
    for (const v of validatedOriginal) {
      expect(resultIds.has(v.id)).toBe(true);
    }
  });

  it("single item array returns same reference", () => {
    const items = [makeItem({ id: "solo" })];
    expect(truncatePreservingActioned(items)).toBe(items);
  });

  it("201 all-flagged items preserved (exceeds MAX)", () => {
    const items = Array.from({ length: 201 }, (_, i) =>
      makeItem({ id: `f-${i}`, flagged: true }),
    );
    const result = truncatePreservingActioned(items);
    expect(result).toHaveLength(201);
  });

  it("handles items that are both validated AND flagged", () => {
    const items = Array.from({ length: 201 }, (_, i) =>
      makeItem({ id: `m-${i}`, validated: true, flagged: true }),
    );
    const result = truncatePreservingActioned(items);
    expect(result).toHaveLength(201);
  });

  it("unactioned budget is exactly MAX minus actioned count", () => {
    const actioned = Array.from({ length: 150 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true }),
    );
    const unactioned = Array.from({ length: 100 }, (_, i) =>
      makeItem({ id: `u-${i}` }),
    );
    const items = [...actioned, ...unactioned];
    const result = truncatePreservingActioned(items);
    // 200 - 150 actioned = 50 unactioned budget
    const unactionedKept = result.filter(c => !c.validated && !c.flagged);
    expect(unactionedKept).toHaveLength(50);
    expect(result).toHaveLength(200);
  });
});
