/**
 * @jest-environment jsdom
 */
import "fake-indexeddb/auto";
import { truncatePreservingActioned, loadCachedContent, saveCachedContent, _resetContentCache } from "@/contexts/content/cache";
import type { ContentItem } from "@/lib/types/content";

// Reset IDB between tests
beforeEach(() => {
  localStorage.clear();
  indexedDB.deleteDatabase("aegis-storage");
});

afterEach(() => _resetContentCache());

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

describe("truncatePreservingActioned", () => {
  it("returns items unchanged when under limit", () => {
    const items = Array.from({ length: 50 }, (_, i) => makeItem({ id: `i-${i}` }));
    const result = truncatePreservingActioned(items);
    expect(result).toBe(items); // same reference
    expect(result).toHaveLength(50);
  });

  it("returns items unchanged at exactly 200", () => {
    const items = Array.from({ length: 200 }, (_, i) => makeItem({ id: `i-${i}` }));
    const result = truncatePreservingActioned(items);
    expect(result).toBe(items);
  });

  it("truncates to 200 when over limit, keeping all actioned items", () => {
    const validated = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `v-${i}`, validated: true }),
    );
    const flagged = Array.from({ length: 30 }, (_, i) =>
      makeItem({ id: `f-${i}`, flagged: true }),
    );
    const unactioned = Array.from({ length: 200 }, (_, i) =>
      makeItem({ id: `u-${i}` }),
    );
    const items = [...validated, ...unactioned, ...flagged];
    expect(items.length).toBe(280);

    const result = truncatePreservingActioned(items);
    expect(result.length).toBe(200);

    // All validated and flagged items must be preserved
    const resultIds = new Set(result.map(c => c.id));
    for (const v of validated) expect(resultIds.has(v.id)).toBe(true);
    for (const f of flagged) expect(resultIds.has(f.id)).toBe(true);
  });

  it("preserves all actioned items even if they exceed 200", () => {
    const actioned = Array.from({ length: 210 }, (_, i) =>
      makeItem({ id: `a-${i}`, validated: true }),
    );
    const unactioned = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `u-${i}` }),
    );
    const items = [...actioned, ...unactioned];

    const result = truncatePreservingActioned(items);
    // All 210 actioned must be kept, 0 unactioned budget
    const resultIds = new Set(result.map(c => c.id));
    for (const a of actioned) expect(resultIds.has(a.id)).toBe(true);
    // No unactioned should be present
    const unactionedKept = result.filter(c => !c.validated && !c.flagged);
    expect(unactionedKept).toHaveLength(0);
  });

  it("preserves original order of items", () => {
    const items = Array.from({ length: 250 }, (_, i) =>
      makeItem({ id: `i-${i}`, validated: i < 10 }),
    );
    const result = truncatePreservingActioned(items);

    // Check that order is maintained
    for (let i = 1; i < result.length; i++) {
      const prevIdx = items.findIndex(c => c.id === result[i - 1].id);
      const currIdx = items.findIndex(c => c.id === result[i].id);
      expect(prevIdx).toBeLessThan(currIdx);
    }
  });

  it("handles mix of validated and flagged items", () => {
    const items = Array.from({ length: 250 }, (_, i) =>
      makeItem({
        id: `i-${i}`,
        validated: i % 3 === 0,
        flagged: i % 5 === 0,
      }),
    );
    const result = truncatePreservingActioned(items);
    expect(result.length).toBeLessThanOrEqual(200);

    // Every actioned item must be present
    const actionedOriginal = items.filter(c => c.validated || c.flagged);
    const resultIds = new Set(result.map(c => c.id));
    for (const a of actionedOriginal) {
      expect(resultIds.has(a.id)).toBe(true);
    }
  });
});

describe("loadCachedContent", () => {
  it("returns empty array when nothing is stored", async () => {
    const result = await loadCachedContent();
    expect(result).toEqual([]);
  });

  it("loads valid items from localStorage", async () => {
    const item = makeItem({ id: "cached-1" });
    localStorage.setItem("aegis-content-cache", JSON.stringify([item]));

    const result = await loadCachedContent();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cached-1");
  });

  it("filters out invalid items from localStorage", async () => {
    const valid = makeItem({ id: "valid" });
    const invalid = { id: "invalid", text: "missing fields" };
    localStorage.setItem("aegis-content-cache", JSON.stringify([valid, invalid]));

    const result = await loadCachedContent();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("valid");
  });

  it("returns empty array for corrupt JSON in localStorage", async () => {
    localStorage.setItem("aegis-content-cache", "{broken json");
    const result = await loadCachedContent();
    expect(result).toEqual([]);
  });

  it("returns empty array for non-array JSON in localStorage", async () => {
    localStorage.setItem("aegis-content-cache", JSON.stringify({ not: "array" }));
    const result = await loadCachedContent();
    expect(result).toEqual([]);
  });

  it("validates all required fields", async () => {
    const testCases = [
      { id: 123, text: "t", source: "rss", createdAt: 1, verdict: "q", validated: true, flagged: false, scores: { composite: 1 } },        // id not string
      { id: "x", text: 123, source: "rss", createdAt: 1, verdict: "q", validated: true, flagged: false, scores: { composite: 1 } },         // text not string
      { id: "x", text: "t", source: 123, createdAt: 1, verdict: "q", validated: true, flagged: false, scores: { composite: 1 } },           // source not string
      { id: "x", text: "t", source: "rss", createdAt: "1", verdict: "q", validated: true, flagged: false, scores: { composite: 1 } },       // createdAt not number
      { id: "x", text: "t", source: "rss", createdAt: 1, verdict: 0, validated: true, flagged: false, scores: { composite: 1 } },           // verdict not string
      { id: "x", text: "t", source: "rss", createdAt: 1, verdict: "q", validated: "yes", flagged: false, scores: { composite: 1 } },        // validated not boolean
      { id: "x", text: "t", source: "rss", createdAt: 1, verdict: "q", validated: true, flagged: "no", scores: { composite: 1 } },          // flagged not boolean
      { id: "x", text: "t", source: "rss", createdAt: 1, verdict: "q", validated: true, flagged: false, scores: null },                     // scores null
      { id: "x", text: "t", source: "rss", createdAt: 1, verdict: "q", validated: true, flagged: false, scores: { } },                     // scores missing composite
      { id: "x", text: "t", source: "rss", createdAt: 1, verdict: "q", validated: true, flagged: false, scores: { composite: "7" } },       // composite not number
      null,
      undefined,
      42,
      "string",
    ];
    localStorage.setItem("aegis-content-cache", JSON.stringify(testCases));
    const result = await loadCachedContent();
    expect(result).toHaveLength(0);
  });
});

describe("saveCachedContent", () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it("does not save immediately (debounced)", () => {
    saveCachedContent([makeItem({ id: "s1" })]);
    // Before debounce fires, localStorage should be empty
    expect(localStorage.getItem("aegis-content-cache")).toBeNull();
  });

  it("writes to localStorage after debounce elapses", () => {
    const items = [makeItem({ id: "debounce-1" })];
    saveCachedContent(items);
    jest.advanceTimersByTime(1000);
    const stored = localStorage.getItem("aegis-content-cache");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("debounce-1");
  });

  it("rapid calls coalesce — only last batch is persisted", () => {
    saveCachedContent([makeItem({ id: "a" })]);
    saveCachedContent([makeItem({ id: "b" })]);
    saveCachedContent([makeItem({ id: "c" })]);
    jest.advanceTimersByTime(1000);
    const stored = localStorage.getItem("aegis-content-cache");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("c");
  });

  it("truncates to 200 items during save", () => {
    const items = Array.from({ length: 250 }, (_, i) => makeItem({ id: `i-${i}` }));
    saveCachedContent(items);
    jest.advanceTimersByTime(1000);
    const stored = localStorage.getItem("aegis-content-cache");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.length).toBeLessThanOrEqual(200);
  });
});
