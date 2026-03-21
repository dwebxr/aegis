import {
  parseFilterParams,
  filterAndPaginate,
  truncateForPreview,
  itemHash,
} from "@/lib/d2a/filterItems";
import type { D2ABriefingItem, D2ABriefingResponse } from "@/lib/d2a/types";

function makeBriefingItem(overrides: Partial<D2ABriefingItem> = {}): D2ABriefingItem {
  return {
    title: "Test Article",
    content: "This is a long test article content that should be truncated in preview mode to verify behavior.",
    source: "rss",
    sourceUrl: "https://example.com/article",
    scores: { originality: 7, insight: 8, credibility: 9, composite: 8 },
    verdict: "quality",
    reason: "Good article",
    topics: ["AI", "DeFi"],
    briefingScore: 0.85,
    ...overrides,
  };
}

function makeBriefing(items: D2ABriefingItem[], generatedAt = "2026-03-20T12:00:00Z"): D2ABriefingResponse {
  return {
    version: "1.0",
    generatedAt,
    source: "aegis",
    sourceUrl: "https://aegis.dwebxr.xyz",
    summary: { totalEvaluated: items.length + 2, totalBurned: 2, qualityRate: items.length / (items.length + 2) },
    items,
    serendipityPick: null,
    meta: { scoringModel: "vcl-v1", nostrPubkey: null, topics: ["AI"] },
  };
}

describe("parseFilterParams", () => {
  it("returns defaults when no params", () => {
    const params = parseFilterParams(new URLSearchParams());
    expect(params).toEqual({ since: undefined, limit: 50, offset: 0, topics: undefined });
  });

  it("parses all params", () => {
    const params = parseFilterParams(
      new URLSearchParams("since=2026-03-20T00:00:00Z&limit=20&offset=5&topics=AI,DeFi"),
    );
    expect(params.since).toBe("2026-03-20T00:00:00.000Z");
    expect(params.limit).toBe(20);
    expect(params.offset).toBe(5);
    expect(params.topics).toEqual(["ai", "defi"]);
  });

  it("clamps limit to max 100", () => {
    const params = parseFilterParams(new URLSearchParams("limit=999"));
    expect(params.limit).toBe(100);
  });

  it("clamps limit to min 1", () => {
    const params = parseFilterParams(new URLSearchParams("limit=0"));
    expect(params.limit).toBe(1);
  });

  it("clamps offset to min 0", () => {
    const params = parseFilterParams(new URLSearchParams("offset=-5"));
    expect(params.offset).toBe(0);
  });

  it("ignores invalid since date", () => {
    const params = parseFilterParams(new URLSearchParams("since=not-a-date"));
    expect(params.since).toBeUndefined();
  });

  it("lowercases topics", () => {
    const params = parseFilterParams(new URLSearchParams("topics=AI,CRYPTO,DeFi"));
    expect(params.topics).toEqual(["ai", "crypto", "defi"]);
  });
});

describe("filterAndPaginate", () => {
  const aiItem = makeBriefingItem({ title: "AI News", topics: ["AI"] });
  const defiItem = makeBriefingItem({ title: "DeFi Update", topics: ["DeFi"] });
  const cryptoItem = makeBriefingItem({ title: "Crypto Market", topics: ["Crypto"] });
  const briefing = makeBriefing([aiItem, defiItem, cryptoItem]);

  it("returns all items with default params", () => {
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0 });
    expect(result.items).toHaveLength(3);
    expect(result.pagination).toEqual({ offset: 0, limit: 50, total: 3, hasMore: false });
  });

  it("paginates with limit and offset", () => {
    const result = filterAndPaginate(briefing, { limit: 1, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("AI News");
    expect(result.pagination).toEqual({ offset: 0, limit: 1, total: 3, hasMore: true });
  });

  it("paginates with offset", () => {
    const result = filterAndPaginate(briefing, { limit: 2, offset: 1 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe("DeFi Update");
    expect(result.pagination.hasMore).toBe(false);
  });

  it("filters by topics", () => {
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0, topics: ["ai"] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("AI News");
    expect(result.pagination.total).toBe(1);
  });

  it("filters by multiple topics (OR)", () => {
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0, topics: ["ai", "crypto"] });
    expect(result.items).toHaveLength(2);
  });

  it("filters by since — excludes old briefings", () => {
    const result = filterAndPaginate(briefing, {
      limit: 50,
      offset: 0,
      since: "2026-03-21T00:00:00Z",
    });
    expect(result.items).toHaveLength(0);
  });

  it("filters by since — includes recent briefings", () => {
    const result = filterAndPaginate(briefing, {
      limit: 50,
      offset: 0,
      since: "2026-03-19T00:00:00Z",
    });
    expect(result.items).toHaveLength(3);
  });

  it("combines topic filter with pagination", () => {
    const manyItems = Array.from({ length: 5 }, (_, i) =>
      makeBriefingItem({ title: `AI Article ${i}`, topics: ["AI"] }),
    );
    const mixed = makeBriefing([...manyItems, defiItem, cryptoItem]);
    const result = filterAndPaginate(mixed, { limit: 2, offset: 1, topics: ["ai"] });
    expect(result.items).toHaveLength(2);
    expect(result.pagination.total).toBe(5);
    expect(result.pagination.hasMore).toBe(true);
  });

  it("preserves non-item fields", () => {
    const result = filterAndPaginate(briefing, { limit: 50, offset: 0 });
    expect(result.version).toBe("1.0");
    expect(result.generatedAt).toBe(briefing.generatedAt);
    expect(result.source).toBe("aegis");
    expect(result.summary).toEqual(briefing.summary);
    expect(result.meta).toEqual(briefing.meta);
    expect(result.serendipityPick).toBeNull();
  });
});

describe("truncateForPreview", () => {
  it("truncates content longer than maxLength", () => {
    const longContent = "A".repeat(300);
    const items = [makeBriefingItem({ content: longContent })];
    const result = truncateForPreview(items, 200);
    expect(result[0].content).toBe("A".repeat(200) + "...");
  });

  it("does not truncate short content", () => {
    const items = [makeBriefingItem({ content: "Short" })];
    const result = truncateForPreview(items, 200);
    expect(result[0].content).toBe("Short");
  });

  it("uses default maxLength of 200", () => {
    const longContent = "B".repeat(250);
    const items = [makeBriefingItem({ content: longContent })];
    const result = truncateForPreview(items);
    expect(result[0].content.length).toBe(203); // 200 + "..."
  });

  it("does not mutate original items", () => {
    const original = makeBriefingItem({ content: "C".repeat(300) });
    truncateForPreview([original]);
    expect(original.content).toBe("C".repeat(300));
  });
});

describe("itemHash", () => {
  it("returns a hex SHA-256 hash", () => {
    const hash = itemHash("Test", "https://example.com");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    const a = itemHash("Test", "https://example.com");
    const b = itemHash("Test", "https://example.com");
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    const a = itemHash("Test A", "https://example.com/a");
    const b = itemHash("Test B", "https://example.com/b");
    expect(a).not.toBe(b);
  });
});
