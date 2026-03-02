/**
 * @jest-environment jsdom
 */

/**
 * Tests for lib/utils/export.ts — filterByScope, downloadFile, exportContentCSV/JSON.
 * Exercises real code paths with actual content data.
 */
import type { ContentItem } from "@/lib/types/content";

// Mock download trigger (jsdom doesn't support blob downloads)
const mockClick = jest.fn();
const mockAnchor = { href: "", download: "", click: mockClick };
const origCreateElement = document.createElement.bind(document);

beforeAll(() => {
  document.createElement = ((tag: string) => {
    if (tag === "a") return mockAnchor as unknown as HTMLAnchorElement;
    return origCreateElement(tag);
  }) as typeof document.createElement;
  (URL as unknown as Record<string, unknown>).createObjectURL = jest.fn(() => "blob:mock-url");
  (URL as unknown as Record<string, unknown>).revokeObjectURL = jest.fn();
});

afterEach(() => {
  mockClick.mockClear();
  mockAnchor.href = "";
  mockAnchor.download = "";
});

// Import AFTER mocks are set up
import { downloadFile, filterByScope, exportContentCSV, exportContentJSON } from "@/lib/utils/export";
import type { ExportScope } from "@/lib/utils/export";

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    owner: "owner-1",
    author: "Test Author",
    avatar: "T",
    text: "Test content",
    source: "rss",
    scores: { originality: 7, insight: 8, credibility: 6, composite: 7.0 },
    verdict: "quality",
    reason: "Good content",
    createdAt: NOW - 1000,
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["tech"],
    ...overrides,
  };
}

/* ========== downloadFile ========== */

describe("downloadFile", () => {
  it("creates a blob URL and triggers click", () => {
    downloadFile("hello,world", "test.csv", "text/csv");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(mockAnchor.download).toBe("test.csv");
    expect(mockClick).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("sets correct href from blob URL", () => {
    downloadFile("{}", "data.json", "application/json");
    expect(mockAnchor.href).toBe("blob:mock-url");
  });

  it("handles empty string data", () => {
    downloadFile("", "empty.csv", "text/csv");
    expect(mockClick).toHaveBeenCalledTimes(1);
  });
});

/* ========== filterByScope ========== */

describe("filterByScope", () => {
  const qualityRecent = makeItem({ id: "qr", verdict: "quality", createdAt: NOW - 1000 });
  const slopRecent = makeItem({ id: "sr", verdict: "slop", createdAt: NOW - 1000 });
  const qualityOld = makeItem({ id: "qo", verdict: "quality", createdAt: NOW - 2 * DAY });
  const slopOld = makeItem({ id: "so", verdict: "slop", createdAt: NOW - 10 * DAY });
  const quality30d = makeItem({ id: "q30", verdict: "quality", createdAt: NOW - 15 * DAY });
  const all = [qualityRecent, slopRecent, qualityOld, slopOld, quality30d];

  describe("type filtering", () => {
    it("returns all items when type is 'all'", () => {
      const result = filterByScope(all, { period: "all", type: "all" });
      expect(result).toHaveLength(5);
    });

    it("returns only quality items when type is 'quality'", () => {
      const result = filterByScope(all, { period: "all", type: "quality" });
      expect(result.every(c => c.verdict === "quality")).toBe(true);
      expect(result).toHaveLength(3);
    });

    it("returns empty array when no quality items", () => {
      const slopOnly = [slopRecent, slopOld];
      const result = filterByScope(slopOnly, { period: "all", type: "quality" });
      expect(result).toHaveLength(0);
    });
  });

  describe("period filtering", () => {
    it("period 'all' returns everything", () => {
      const result = filterByScope(all, { period: "all", type: "all" });
      expect(result).toHaveLength(5);
    });

    it("period 'today' returns items within last 24h", () => {
      const result = filterByScope(all, { period: "today", type: "all" });
      // qualityRecent + slopRecent are within 24h
      expect(result).toHaveLength(2);
      expect(result.map(c => c.id).sort()).toEqual(["qr", "sr"]);
    });

    it("period '7d' returns items within last 7 days", () => {
      const result = filterByScope(all, { period: "7d", type: "all" });
      // qualityRecent, slopRecent (today), qualityOld (2 days ago)
      expect(result).toHaveLength(3);
    });

    it("period '30d' returns items within last 30 days", () => {
      const result = filterByScope(all, { period: "30d", type: "all" });
      // all except none — slopOld is 10d ago, quality30d is 15d ago
      expect(result).toHaveLength(5);
    });
  });

  describe("combined filtering", () => {
    it("quality + today returns only recent quality", () => {
      const result = filterByScope(all, { period: "today", type: "quality" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("qr");
    });

    it("quality + 7d excludes old slop and items outside 7d", () => {
      const result = filterByScope(all, { period: "7d", type: "quality" });
      // qualityRecent (today) + qualityOld (2 days ago)
      expect(result).toHaveLength(2);
    });
  });

  describe("boundary conditions", () => {
    it("handles empty array input", () => {
      expect(filterByScope([], { period: "today", type: "quality" })).toEqual([]);
    });

    it("item exactly at 24h boundary is excluded by 'today'", () => {
      const boundary = makeItem({ id: "boundary", createdAt: NOW - DAY - 1 });
      expect(filterByScope([boundary], { period: "today", type: "all" })).toHaveLength(0);
    });

    it("item just inside 24h boundary is included by 'today'", () => {
      const inside = makeItem({ id: "inside", createdAt: NOW - DAY + 1000 });
      expect(filterByScope([inside], { period: "today", type: "all" })).toHaveLength(1);
    });

    it("item exactly at 7d boundary is excluded", () => {
      const boundary = makeItem({ id: "b7", createdAt: NOW - 7 * DAY - 1 });
      expect(filterByScope([boundary], { period: "7d", type: "all" })).toHaveLength(0);
    });

    it("item exactly at 30d boundary is excluded", () => {
      const boundary = makeItem({ id: "b30", createdAt: NOW - 30 * DAY - 1 });
      expect(filterByScope([boundary], { period: "30d", type: "all" })).toHaveLength(0);
    });

    it("preserves original array order", () => {
      const items = [
        makeItem({ id: "c", createdAt: NOW - 100 }),
        makeItem({ id: "a", createdAt: NOW - 200 }),
        makeItem({ id: "b", createdAt: NOW - 300 }),
      ];
      const result = filterByScope(items, { period: "today", type: "all" });
      expect(result.map(c => c.id)).toEqual(["c", "a", "b"]);
    });

    it("does not mutate input array", () => {
      const items = [qualityRecent, slopRecent];
      const copy = [...items];
      filterByScope(items, { period: "today", type: "quality" });
      expect(items).toEqual(copy);
    });
  });
});

/* ========== exportContentCSV / exportContentJSON ========== */

describe("exportContentCSV", () => {
  it("triggers download with .csv extension", () => {
    const items = [makeItem()];
    exportContentCSV(items);
    expect(mockAnchor.download).toMatch(/^aegis-evaluations-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it("uses default scope when none provided", () => {
    const items = [
      makeItem({ id: "q", verdict: "quality" }),
      makeItem({ id: "s", verdict: "slop" }),
    ];
    exportContentCSV(items);
    // Default scope is all/all — both items should be exported
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it("applies scope filter before export", () => {
    const old = makeItem({ id: "old", createdAt: NOW - 2 * DAY });
    const recent = makeItem({ id: "new", createdAt: NOW - 1000 });
    exportContentCSV([old, recent], { period: "today", type: "all" });
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it("exports empty content without error", () => {
    exportContentCSV([]);
    expect(mockClick).toHaveBeenCalledTimes(1);
  });
});

describe("exportContentJSON", () => {
  it("triggers download with .json extension", () => {
    const items = [makeItem()];
    exportContentJSON(items);
    expect(mockAnchor.download).toMatch(/^aegis-evaluations-\d{4}-\d{2}-\d{2}\.json$/);
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it("applies scope filter before export", () => {
    const slop = makeItem({ verdict: "slop" });
    const quality = makeItem({ verdict: "quality" });
    exportContentJSON([slop, quality], { period: "all", type: "quality" });
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it("exports empty content without error", () => {
    exportContentJSON([]);
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it("uses default scope when none provided", () => {
    exportContentJSON([makeItem()]);
    expect(mockClick).toHaveBeenCalledTimes(1);
  });
});
