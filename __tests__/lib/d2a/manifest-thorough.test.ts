import { hashContent, buildManifest, diffManifest, decodeManifest, type ContentManifest } from "@/lib/d2a/manifest";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "owner",
    author: "Author",
    avatar: "📡",
    text: "Test article content about technology and innovation",
    source: "rss",
    scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 },
    verdict: "quality",
    reason: "Good article",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "1h ago",
    topics: ["tech"],
    ...overrides,
  };
}

describe("hashContent", () => {
  it("returns 32-char hex string", () => {
    const hash = hashContent("hello world");
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("deterministic: same input → same hash", () => {
    expect(hashContent("test")).toBe(hashContent("test"));
  });

  it("different inputs → different hashes", () => {
    expect(hashContent("input A")).not.toBe(hashContent("input B"));
  });

  it("empty string produces valid hash", () => {
    const hash = hashContent("");
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("very long text produces valid hash", () => {
    const hash = hashContent("x".repeat(100_000));
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("unicode text produces valid hash", () => {
    const hash = hashContent("日本語テスト 🎉");
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("buildManifest", () => {
  it("filters items below MIN_OFFER_SCORE (7.0)", () => {
    const items = [
      makeItem({ id: "low", scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 } }),
      makeItem({ id: "high", scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 } }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].score).toBe(8.0);
  });

  it("filters non-quality items", () => {
    const items = [
      makeItem({ id: "slop", verdict: "slop", scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 } }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(0);
  });

  it("filters items without topics", () => {
    const items = [
      makeItem({ id: "no-topics", topics: [] }),
      makeItem({ id: "no-topics-2", topics: undefined }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(0);
  });

  it("sorts by composite descending", () => {
    const items = [
      makeItem({ id: "mid", text: "mid content", scores: { originality: 7, insight: 7, credibility: 7, composite: 7.5 } }),
      makeItem({ id: "top", text: "top content", scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 } }),
      makeItem({ id: "low", text: "low content", scores: { originality: 7, insight: 7, credibility: 7, composite: 7.1 } }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].score).toBe(9.0);
    expect(manifest.entries[1].score).toBe(7.5);
    expect(manifest.entries[2].score).toBe(7.1);
  });

  it("limits to 50 entries", () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      makeItem({
        id: `item-${i}`,
        text: `Article ${i} with distinct content`,
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 + i * 0.01 },
      }),
    );
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(50);
  });

  it("rounds score to 1 decimal place", () => {
    const items = [
      makeItem({ scores: { originality: 8, insight: 8, credibility: 8, composite: 7.777 } }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].score).toBe(7.8);
  });

  it("uses first topic for manifest entry", () => {
    const items = [
      makeItem({ topics: ["crypto", "finance", "tech"] }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].topic).toBe("crypto");
  });

  it("generatedAt is a recent timestamp", () => {
    const before = Date.now();
    const manifest = buildManifest([makeItem()]);
    expect(manifest.generatedAt).toBeGreaterThanOrEqual(before);
    expect(manifest.generatedAt).toBeLessThanOrEqual(Date.now());
  });

  it("empty input produces empty manifest", () => {
    const manifest = buildManifest([]);
    expect(manifest.entries).toHaveLength(0);
  });
});

describe("decodeManifest", () => {
  it("decodes valid manifest JSON", () => {
    const raw = JSON.stringify({
      entries: [{ hash: "abc123", topic: "tech", score: 8.5 }],
      generatedAt: 12345,
    });
    const result = decodeManifest(raw);
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(1);
    expect(result!.generatedAt).toBe(12345);
  });

  it("returns null for empty string", () => {
    expect(decodeManifest("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(decodeManifest("{not valid")).toBeNull();
  });

  it("returns null for missing entries array", () => {
    expect(decodeManifest(JSON.stringify({ generatedAt: 1 }))).toBeNull();
  });

  it("returns null for missing generatedAt", () => {
    expect(decodeManifest(JSON.stringify({ entries: [] }))).toBeNull();
  });

  it("returns null for non-number generatedAt", () => {
    expect(decodeManifest(JSON.stringify({ entries: [], generatedAt: "not-number" }))).toBeNull();
  });

  it("returns null for entry with wrong types", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: 123, topic: "tech", score: 8 }],
      generatedAt: 1,
    }))).toBeNull();
  });

  it("returns null for entry missing fields", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: "abc" }],
      generatedAt: 1,
    }))).toBeNull();
  });

  it("accepts empty entries array", () => {
    const result = decodeManifest(JSON.stringify({ entries: [], generatedAt: 1 }));
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(0);
  });
});

describe("diffManifest — set difference with topic intersection", () => {
  const peerManifest: ContentManifest = {
    entries: [
      { hash: hashContent("Existing article about AI"), topic: "ai", score: 8.0 },
      { hash: hashContent("Existing article about crypto"), topic: "crypto", score: 7.5 },
    ],
    generatedAt: Date.now(),
  };

  it("returns items the peer doesn't have (by hash)", () => {
    const myContent = [
      makeItem({ id: "new", text: "Brand new unique article", topics: ["ai"] }),
    ];
    const diff = diffManifest(myContent, peerManifest);
    expect(diff).toHaveLength(1);
    expect(diff[0].id).toBe("new");
  });

  it("excludes items the peer already has", () => {
    const myContent = [
      makeItem({ id: "dup", text: "Existing article about AI", topics: ["ai"] }),
    ];
    const diff = diffManifest(myContent, peerManifest);
    expect(diff).toHaveLength(0);
  });

  it("only includes items with overlapping topics", () => {
    const myContent = [
      makeItem({ id: "no-overlap", text: "Article about gardening", topics: ["gardening"] }),
    ];
    const diff = diffManifest(myContent, peerManifest);
    expect(diff).toHaveLength(0);
  });

  it("excludes slop items", () => {
    const myContent = [
      makeItem({ id: "slop", text: "New but slop", verdict: "slop", topics: ["ai"] }),
    ];
    const diff = diffManifest(myContent, peerManifest);
    expect(diff).toHaveLength(0);
  });

  it("excludes items below MIN_OFFER_SCORE", () => {
    const myContent = [
      makeItem({ id: "low", text: "Low score article",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 }, topics: ["ai"] }),
    ];
    const diff = diffManifest(myContent, peerManifest);
    expect(diff).toHaveLength(0);
  });

  it("sorts results by composite descending", () => {
    const myContent = [
      makeItem({ id: "mid", text: "Mid content aaa", topics: ["ai"],
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7.5 } }),
      makeItem({ id: "top", text: "Top content bbb", topics: ["crypto"],
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 } }),
    ];
    const diff = diffManifest(myContent, peerManifest);
    expect(diff[0].id).toBe("top");
    expect(diff[1].id).toBe("mid");
  });
});
