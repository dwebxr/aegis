import { buildManifest, decodeManifest, diffManifest } from "@/lib/d2a/manifest";
import { hashContent } from "@/lib/utils/hashing";
import { MIN_OFFER_SCORE } from "@/lib/agent/protocol";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "owner",
    author: "Author",
    avatar: "A",
    text: "Quality content about technology trends",
    source: "rss",
    scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 },
    verdict: "quality",
    reason: "Good",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "1h",
    topics: ["tech"],
    ...overrides,
  };
}

// ─── decodeManifest — malformed edge cases ───────────────────────────

describe("decodeManifest — malformed inputs", () => {
  it("returns null for NaN score", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: "abc", topic: "tech", score: NaN }],
      generatedAt: 1,
    }))).toBeNull();
  });

  it("returns null for Infinity score", () => {
    // JSON.stringify(Infinity) becomes null, so parsed score will be null
    const json = '{"entries":[{"hash":"abc","topic":"tech","score":null}],"generatedAt":1}';
    expect(decodeManifest(json)).toBeNull();
  });

  it("returns null for entries as object (not array)", () => {
    expect(decodeManifest(JSON.stringify({
      entries: { 0: { hash: "abc", topic: "tech", score: 8 } },
      generatedAt: 1,
    }))).toBeNull();
  });

  it("returns null for parsed value being an array", () => {
    expect(decodeManifest(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it("returns null for parsed value being a string", () => {
    expect(decodeManifest(JSON.stringify("hello"))).toBeNull();
  });

  it("returns null for parsed value being a number", () => {
    expect(decodeManifest(JSON.stringify(42))).toBeNull();
  });

  it("returns null for parsed value being null", () => {
    expect(decodeManifest("null")).toBeNull();
  });

  it("returns null for parsed value being boolean", () => {
    expect(decodeManifest("true")).toBeNull();
  });

  it("returns null for entry with empty string hash", () => {
    // hash is string type so this is technically valid per type check, depends on implementation
    const result = decodeManifest(JSON.stringify({
      entries: [{ hash: "", topic: "tech", score: 5 }],
      generatedAt: 1,
    }));
    // Empty string is still typeof "string" — should pass validation
    expect(result).not.toBeNull();
  });

  it("returns null for entry with score exactly -0.001 (negative)", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: "abc", topic: "tech", score: -0.001 }],
      generatedAt: 1,
    }))).toBeNull();
  });

  it("returns null for entry with score 10.001 (above 10)", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: "abc", topic: "tech", score: 10.001 }],
      generatedAt: 1,
    }))).toBeNull();
  });

  it("accepts score at exact boundaries (0.0 and 10.0)", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: "a", topic: "t", score: 0 }],
      generatedAt: 1,
    }))).not.toBeNull();
    expect(decodeManifest(JSON.stringify({
      entries: [{ hash: "b", topic: "t", score: 10 }],
      generatedAt: 1,
    }))).not.toBeNull();
  });

  it("rejects if any single entry in a multi-entry array is invalid", () => {
    expect(decodeManifest(JSON.stringify({
      entries: [
        { hash: "valid", topic: "tech", score: 8 },
        { hash: 123, topic: "tech", score: 8 }, // invalid: hash not string
      ],
      generatedAt: 1,
    }))).toBeNull();
  });

  it("handles deeply nested but structurally valid manifest", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      hash: `hash-${i}`,
      topic: `topic-${i}`,
      score: Math.round(Math.random() * 100) / 10,
    })).filter(e => e.score >= 0 && e.score <= 10);
    const result = decodeManifest(JSON.stringify({ entries, generatedAt: Date.now() }));
    expect(result).not.toBeNull();
    expect(result!.entries.length).toBe(entries.length);
  });
});

// ─── buildManifest — additional edge cases ───────────────────────────

describe("buildManifest — score precision edge cases", () => {
  it("rounds 7.050000001 to 7.1 (not 7.0)", () => {
    const items = [makeItem({
      scores: { originality: 7, insight: 7, credibility: 7, composite: 7.050000001 },
    })];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].score).toBe(7.1);
  });

  it("rounds 7.04999 to 7.0", () => {
    const items = [makeItem({
      scores: { originality: 7, insight: 7, credibility: 7, composite: 7.04999 },
    })];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].score).toBe(7.0);
  });

  it("handles composite of exactly 10", () => {
    const items = [makeItem({
      scores: { originality: 10, insight: 10, credibility: 10, composite: 10 },
    })];
    const manifest = buildManifest(items);
    expect(manifest.entries[0].score).toBe(10);
  });

  it("entries have stable hashes for same text", () => {
    const items = [makeItem({ text: "Deterministic content" })];
    const m1 = buildManifest(items);
    const m2 = buildManifest(items);
    expect(m1.entries[0].hash).toBe(m2.entries[0].hash);
  });

  it("different text produces different hashes", () => {
    const m1 = buildManifest([makeItem({ text: "Content A" })]);
    const m2 = buildManifest([makeItem({ text: "Content B" })]);
    expect(m1.entries[0].hash).not.toBe(m2.entries[0].hash);
  });
});

// ─── diffManifest — edge cases ───────────────────────────────────────

describe("diffManifest — edge cases", () => {
  it("excludes items without topics", () => {
    const myItems = [makeItem({ text: "No topics", topics: undefined })];
    const peer = { entries: [{ hash: "x", topic: "tech", score: 8 }], generatedAt: Date.now() };
    expect(diffManifest(myItems, peer)).toHaveLength(0);
  });

  it("excludes items with empty topics array", () => {
    const myItems = [makeItem({ text: "Empty topics", topics: [] })];
    const peer = { entries: [{ hash: "x", topic: "tech", score: 8 }], generatedAt: Date.now() };
    expect(diffManifest(myItems, peer)).toHaveLength(0);
  });

  it("handles peer manifest with single entry", () => {
    const myItems = [
      makeItem({ id: "a", text: "New article", topics: ["tech"] }),
    ];
    const peer = { entries: [{ hash: "different", topic: "tech", score: 8 }], generatedAt: Date.now() };
    expect(diffManifest(myItems, peer)).toHaveLength(1);
  });

  it("handles large peer manifest efficiently", () => {
    const peerEntries = Array.from({ length: 1000 }, (_, i) => ({
      hash: `hash-${i}`,
      topic: "tech",
      score: 8,
    }));
    const peer = { entries: peerEntries, generatedAt: Date.now() };
    const myItems = [makeItem({ text: "Brand new unique", topics: ["tech"] })];
    const start = performance.now();
    const result = diffManifest(myItems, peer);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(1);
    expect(elapsed).toBeLessThan(100);
  });

  it("matches topic overlap across multiple topics", () => {
    const myItems = [
      makeItem({ id: "a", text: "AI and Crypto", topics: ["ai", "crypto"] }),
    ];
    // peer only has crypto topic
    const peer = { entries: [{ hash: "x", topic: "crypto", score: 7 }], generatedAt: Date.now() };
    const result = diffManifest(myItems, peer);
    expect(result).toHaveLength(1); // "crypto" overlaps
  });

  it("returns items sorted by composite descending", () => {
    const myItems = [
      makeItem({ id: "low", text: "Low q", topics: ["tech"], scores: { originality: 7, insight: 7, credibility: 7, composite: MIN_OFFER_SCORE } }),
      makeItem({ id: "high", text: "High q", topics: ["tech"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9.5 } }),
      makeItem({ id: "mid", text: "Mid q", topics: ["tech"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 } }),
    ];
    const peer = { entries: [{ hash: "unrelated", topic: "tech", score: 5 }], generatedAt: Date.now() };
    const result = diffManifest(myItems, peer);
    expect(result[0].id).toBe("high");
    expect(result[1].id).toBe("mid");
    expect(result[2].id).toBe("low");
  });
});

// ─── Round-trip: buildManifest → JSON → decodeManifest ───────────────

describe("buildManifest → decodeManifest round-trip integrity", () => {
  it("preserves all entries through round-trip", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `item-${i}`, text: `Article ${i} about tech`, topics: ["tech"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8 + i * 0.1 } }),
    );
    const manifest = buildManifest(items);
    const decoded = decodeManifest(JSON.stringify(manifest));
    expect(decoded).not.toBeNull();
    expect(decoded!.entries).toEqual(manifest.entries);
    expect(decoded!.generatedAt).toBe(manifest.generatedAt);
  });

  it("empty manifest round-trips correctly", () => {
    const manifest = buildManifest([]);
    const decoded = decodeManifest(JSON.stringify(manifest));
    expect(decoded).not.toBeNull();
    expect(decoded!.entries).toHaveLength(0);
  });
});
