import {
  buildManifestWith,
  decodeManifest,
  diffManifestWith,
  MANIFEST_MAX_ENTRIES,
  type ManifestableItem,
} from "../src/manifest";

const fakeHash = (text: string): string => `hash:${text.length}:${text.slice(0, 4)}`;

function makeItem(overrides: Partial<ManifestableItem> = {}): ManifestableItem {
  return {
    text: "some content text",
    scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
    verdict: "quality",
    topics: ["tech"],
    ...overrides,
  };
}

describe("buildManifestWith", () => {
  it("includes only quality items at or above MIN_OFFER_SCORE with at least one topic", () => {
    const items: ManifestableItem[] = [
      makeItem({ text: "ok",      scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ text: "low",     scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
      makeItem({ text: "slop",    verdict: "slop", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ text: "notopic", topics: [],     scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    ];
    const m = buildManifestWith(items, fakeHash);
    expect(m.entries.length).toBe(1);
    expect(m.entries[0].hash).toBe(fakeHash("ok"));
    expect(m.entries[0].topic).toBe("tech");
    expect(m.entries[0].score).toBe(9);
  });

  it("sorts by composite descending and caps at MANIFEST_MAX_ENTRIES", () => {
    const items: ManifestableItem[] = Array.from({ length: 60 }, (_, i) =>
      makeItem({
        text: `t-${i}`,
        scores: { originality: 8, insight: 8, credibility: 8, composite: 7 + (i % 30) / 10 },
      }),
    );
    const m = buildManifestWith(items, fakeHash);
    expect(m.entries.length).toBe(MANIFEST_MAX_ENTRIES);
    for (let i = 1; i < m.entries.length; i++) {
      expect(m.entries[i - 1].score).toBeGreaterThanOrEqual(m.entries[i].score);
    }
  });

  it("rounds composite to one decimal place", () => {
    const m = buildManifestWith(
      [makeItem({ scores: { originality: 8, insight: 8, credibility: 8, composite: 8.27 } })],
      fakeHash,
    );
    expect(m.entries[0].score).toBe(8.3);
  });
});

describe("decodeManifest", () => {
  it("returns null on empty input", () => {
    expect(decodeManifest("")).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    expect(decodeManifest("not json")).toBeNull();
  });

  it("returns null on missing entries array", () => {
    expect(decodeManifest(JSON.stringify({ generatedAt: 1 }))).toBeNull();
  });

  it("returns null on out-of-range score", () => {
    const raw = JSON.stringify({ entries: [{ hash: "x", topic: "t", score: 11 }], generatedAt: 1 });
    expect(decodeManifest(raw)).toBeNull();
  });

  it("returns the parsed manifest on a well-formed payload", () => {
    const raw = JSON.stringify({
      entries: [{ hash: "abc", topic: "rust", score: 9.1 }],
      generatedAt: 1735689600000,
    });
    const m = decodeManifest(raw);
    expect(m).not.toBeNull();
    expect(m!.entries).toHaveLength(1);
    expect(m!.entries[0].topic).toBe("rust");
  });
});

describe("diffManifestWith", () => {
  it("returns items the peer has not seen AND that share at least one topic", () => {
    const peerManifest = {
      entries: [
        { hash: fakeHash("seen"), topic: "rust", score: 9 },
      ],
      generatedAt: 1,
    };
    const mine: ManifestableItem[] = [
      makeItem({ text: "seen", topics: ["rust"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ text: "new1", topics: ["rust"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ text: "newx", topics: ["unrelated"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    ];
    const diff = diffManifestWith(mine, peerManifest, fakeHash);
    expect(diff.map(d => d.text)).toEqual(["new1"]);
  });

  it("returns sorted by composite descending", () => {
    const peerManifest = { entries: [{ hash: "x", topic: "rust", score: 9 }], generatedAt: 1 };
    const mine: ManifestableItem[] = [
      makeItem({ text: "a", topics: ["rust"], scores: { originality: 8, insight: 8, credibility: 8, composite: 7.5 } }),
      makeItem({ text: "b", topics: ["rust"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 } }),
      makeItem({ text: "c", topics: ["rust"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8.2 } }),
    ];
    const diff = diffManifestWith(mine, peerManifest, fakeHash);
    expect(diff.map(d => d.text)).toEqual(["b", "c", "a"]);
  });
});
