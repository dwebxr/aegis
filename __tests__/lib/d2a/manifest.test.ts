import {
  buildManifest,
  decodeManifest,
  diffManifest,
} from "@/lib/d2a/manifest";
import { hashContent } from "@/lib/utils/hashing";
import type { ContentItem } from "@/lib/types/content";
import { MIN_OFFER_SCORE } from "@/lib/agent/protocol";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-id",
    owner: "owner",
    author: "Author",
    avatar: "A",
    text: "Some quality content text here",
    source: "manual",
    scores: { originality: 8, insight: 7, credibility: 8, composite: 7.5 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["tech", "ai"],
    ...overrides,
  };
}

describe("hashContent", () => {
  it("returns a 32-char hex string", () => {
    const hash = hashContent("hello world");
    expect(hash).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns same hash for same input", () => {
    expect(hashContent("test")).toBe(hashContent("test"));
  });

  it("returns different hash for different input", () => {
    expect(hashContent("foo")).not.toBe(hashContent("bar"));
  });
});

describe("buildManifest", () => {
  it("builds manifest from quality items", () => {
    const items = [
      makeItem({ id: "1", text: "First article" }),
      makeItem({ id: "2", text: "Second article" }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.generatedAt).toBeGreaterThan(0);
  });

  it("excludes slop items", () => {
    const items = [
      makeItem({ id: "1", text: "Good", verdict: "quality" }),
      makeItem({ id: "2", text: "Bad", verdict: "slop" }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(1);
  });

  it("excludes low-score items", () => {
    const items = [
      makeItem({ id: "1", text: "Good", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "2", text: "Meh", scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(1);
  });

  it("excludes items without topics", () => {
    const items = [
      makeItem({ id: "1", text: "Has topics", topics: ["tech"] }),
      makeItem({ id: "2", text: "No topics", topics: [] }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(1);
  });

  it("limits to 50 entries", () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      makeItem({ id: `item-${i}`, text: `Article ${i}` }),
    );
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(50);
  });

  it("sorts by score descending", () => {
    const items = [
      makeItem({ id: "1", text: "Low", scores: { originality: 7, insight: 7, credibility: 7, composite: MIN_OFFER_SCORE } }),
      makeItem({ id: "2", text: "High", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    ];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].score).toBeGreaterThan(manifest.entries[1].score);
  });

  it("uses first topic as manifest entry topic", () => {
    const items = [makeItem({ id: "1", text: "Multi", topics: ["primary", "secondary"] })];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].topic).toBe("primary");
  });
});

describe("JSON.stringify / decodeManifest round-trip", () => {
  it("round-trips a manifest", () => {
    const items = [makeItem({ id: "1", text: "Test" })];
    const manifest = buildManifest(items);
    const encoded = JSON.stringify(manifest);
    const decoded = decodeManifest(encoded);
    expect(decoded).toEqual(manifest);
  });

  it("returns null for empty string", () => {
    expect(decodeManifest("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(decodeManifest("{invalid")).toBeNull();
  });

  it("returns null for missing entries array", () => {
    expect(decodeManifest(JSON.stringify({ generatedAt: 123 }))).toBeNull();
  });

  it("returns null for invalid entry structure", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: 123, topic: "t", score: 1 }],
      generatedAt: 123,
    }))).toBeNull();
  });
});

describe("diffManifest", () => {
  it("returns items not in peer manifest", () => {
    const myItems = [
      makeItem({ id: "1", text: "Unique article", topics: ["tech"] }),
      makeItem({ id: "2", text: "Shared article", topics: ["tech"] }),
    ];
    const peerManifest = buildManifest([
      makeItem({ id: "3", text: "Shared article", topics: ["tech"] }),
    ]);
    const diff = diffManifest(myItems, peerManifest);
    expect(diff).toHaveLength(1);
    expect(diff[0].id).toBe("1");
  });

  it("returns empty array when all content is shared", () => {
    const shared = makeItem({ id: "1", text: "Same content", topics: ["tech"] });
    const peerManifest = buildManifest([shared]);
    const diff = diffManifest([shared], peerManifest);
    expect(diff).toHaveLength(0);
  });

  it("filters by topic overlap with peer", () => {
    const myItems = [
      makeItem({ id: "1", text: "Tech article", topics: ["tech"] }),
      makeItem({ id: "2", text: "Sports article", topics: ["sports"] }),
    ];
    const peerManifest = buildManifest([
      makeItem({ id: "3", text: "Peer tech content", topics: ["tech"] }),
    ]);
    const diff = diffManifest(myItems, peerManifest);
    // Only tech article matches peer's topic interests
    expect(diff).toHaveLength(1);
    expect(diff[0].topics![0]).toBe("tech");
  });

  it("excludes slop and low-score items", () => {
    const myItems = [
      makeItem({ id: "1", text: "Good", topics: ["tech"] }),
      makeItem({ id: "2", text: "Slop", verdict: "slop", topics: ["tech"] }),
      makeItem({ id: "3", text: "Low", scores: { originality: 2, insight: 2, credibility: 2, composite: 2 }, topics: ["tech"] }),
    ];
    const peerManifest = buildManifest([
      makeItem({ id: "p1", text: "Peer", topics: ["tech"] }),
    ]);
    const diff = diffManifest(myItems, peerManifest);
    expect(diff).toHaveLength(1);
    expect(diff[0].id).toBe("1");
  });

  it("returns empty array when myContent is empty", () => {
    const peerManifest = buildManifest([makeItem({ id: "p1", text: "Peer", topics: ["tech"] })]);
    expect(diffManifest([], peerManifest)).toEqual([]);
  });

  it("returns all matching items when peerManifest is empty", () => {
    const myItems = [
      makeItem({ id: "1", text: "Article", topics: ["tech"] }),
    ];
    const emptyManifest = { entries: [], generatedAt: Date.now() };
    // No peer hashes to match against, but also no peer topics to overlap with
    const diff = diffManifest(myItems, emptyManifest);
    // Empty peer topics → c.topics.some(t => peerTopics.has(t)) is false → no results
    expect(diff).toHaveLength(0);
  });

  it("sorts diff results by score descending", () => {
    const myItems = [
      makeItem({ id: "1", text: "Low quality A", topics: ["tech"], scores: { originality: 7, insight: 7, credibility: 7, composite: 7.0 } }),
      makeItem({ id: "2", text: "High quality B", topics: ["tech"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9.5 } }),
      makeItem({ id: "3", text: "Mid quality C", topics: ["tech"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 } }),
    ];
    const peerManifest = { entries: [{ hash: "0000000000000000", topic: "tech", score: 5 }], generatedAt: Date.now() };
    const diff = diffManifest(myItems, peerManifest);
    expect(diff[0].scores.composite).toBe(9.5);
    expect(diff[1].scores.composite).toBe(8.0);
    expect(diff[2].scores.composite).toBe(7.0);
  });

  it("matches multi-topic items when any topic overlaps", () => {
    const myItems = [
      makeItem({ id: "1", text: "Cross-domain article", topics: ["cooking", "ai"] }),
    ];
    const peerManifest = { entries: [{ hash: "aaaa", topic: "ai", score: 8 }], generatedAt: Date.now() };
    const diff = diffManifest(myItems, peerManifest);
    expect(diff).toHaveLength(1);
  });
});

// ─── Edge cases ───

describe("hashContent — edge cases", () => {
  it("hashes empty string", () => {
    const hash = hashContent("");
    expect(hash).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("hashes unicode content deterministically", () => {
    const h1 = hashContent("日本語テスト");
    const h2 = hashContent("日本語テスト");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(32);
  });

  it("hashes emoji content", () => {
    const hash = hashContent("🚀🌍💡");
    expect(hash).toHaveLength(32);
  });
});

describe("buildManifest — boundary conditions", () => {
  it("returns empty manifest for empty array", () => {
    const manifest = buildManifest([]);
    expect(manifest.entries).toHaveLength(0);
    expect(manifest.generatedAt).toBeGreaterThan(0);
  });

  it("excludes items with undefined topics", () => {
    const items = [makeItem({ id: "1", text: "No topics", topics: undefined })];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(0);
  });

  it("includes item at exact MIN_OFFER_SCORE boundary", () => {
    const items = [makeItem({
      id: "1",
      text: "Boundary",
      scores: { originality: 7, insight: 7, credibility: 7, composite: MIN_OFFER_SCORE },
    })];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(1);
  });

  it("excludes item just below MIN_OFFER_SCORE", () => {
    const items = [makeItem({
      id: "1",
      text: "Below boundary",
      scores: { originality: 6, insight: 6, credibility: 6, composite: MIN_OFFER_SCORE - 0.1 },
    })];
    const manifest = buildManifest(items);
    expect(manifest.entries).toHaveLength(0);
  });

  it("rounds score to 1 decimal place", () => {
    const items = [makeItem({
      id: "1",
      text: "Precision test",
      scores: { originality: 8, insight: 8, credibility: 8, composite: 7.777 },
    })];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].score).toBe(7.8);
  });
});

describe("decodeManifest — validation edge cases", () => {
  it("returns valid for empty entries array", () => {
    const result = decodeManifest(JSON.stringify({ entries: [], generatedAt: 100 }));
    expect(result).toEqual({ entries: [], generatedAt: 100 });
  });

  it("returns null when generatedAt is string", () => {
    expect(decodeManifest(JSON.stringify({ entries: [], generatedAt: "not-a-number" }))).toBeNull();
  });

  it("returns null when entries contains entry with missing hash", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ topic: "t", score: 1 }],
      generatedAt: 100,
    }))).toBeNull();
  });

  it("returns null when entries is null", () => {
    expect(decodeManifest(JSON.stringify({ entries: null, generatedAt: 100 }))).toBeNull();
  });

  it("returns null when entries contains null element", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [null],
      generatedAt: 100,
    }))).toBeNull();
  });

  it("returns null when entries contains undefined-like element", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: "a".repeat(32), topic: "tech", score: 8 }, null],
      generatedAt: 100,
    }))).toBeNull();
  });

  it("accepts extra fields (forward compatibility)", () => {
    const result = decodeManifest(JSON.stringify({
      entries: [{ hash: "a".repeat(32), topic: "tech", score: 8, extra: "ignored" }],
      generatedAt: 100,
      version: 2,
    }));
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(1);
  });
});
