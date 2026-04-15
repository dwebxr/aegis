/**
 * Manifest tests exercise the SubtleCrypto SHA-256 path (Node 20+ ships it
 * natively, no mock). decodeManifest is sync; buildManifest and diffManifest
 * are async.
 */

import { webcrypto } from "node:crypto";
import {
  buildManifest,
  decodeManifest,
  diffManifest,
  MANIFEST_MAX_ENTRIES,
  type ManifestableItem,
} from "../src/manifest";
import { MIN_OFFER_SCORE } from "../src/protocol";

if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

function makeItem(overrides: Partial<ManifestableItem> = {}): ManifestableItem {
  return {
    text: "default text",
    scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
    verdict: "quality",
    topics: ["tech"],
    ...overrides,
  };
}

describe("buildManifest — real SubtleCrypto SHA-256", () => {
  it("produces 64-char lowercase hex hashes", async () => {
    const m = await buildManifest([makeItem({ text: "hello world" })]);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes match the documented SHA-256 of the canonical text", async () => {
    // SHA-256("hello world") = b94d27b9...
    const m = await buildManifest([makeItem({ text: "hello world" })]);
    expect(m.entries[0].hash).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("produces stable hashes across calls", async () => {
    const a = await buildManifest([makeItem({ text: "stable" })]);
    const b = await buildManifest([makeItem({ text: "stable" })]);
    expect(a.entries[0].hash).toBe(b.entries[0].hash);
  });

  it("filters out below-threshold + slop + topicless items", async () => {
    const items = [
      makeItem({ text: "in" }),
      makeItem({ text: "lo", scores: { originality: 5, insight: 5, credibility: 5, composite: MIN_OFFER_SCORE - 0.5 } }),
      makeItem({ text: "sl", verdict: "slop" }),
      makeItem({ text: "no", topics: [] }),
    ];
    const m = await buildManifest(items);
    expect(m.entries.map(e => e.topic)).toEqual(["tech"]);
  });

  it("sorts by composite descending and caps at MANIFEST_MAX_ENTRIES", async () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      makeItem({
        text: `t-${i}`,
        scores: { originality: 8, insight: 8, credibility: 8, composite: 7 + (i % 30) / 10 },
      }),
    );
    const m = await buildManifest(items);
    expect(m.entries).toHaveLength(MANIFEST_MAX_ENTRIES);
    for (let i = 1; i < m.entries.length; i++) {
      expect(m.entries[i - 1].score).toBeGreaterThanOrEqual(m.entries[i].score);
    }
  });

  it("rounds composite to one decimal place", async () => {
    const m = await buildManifest([
      makeItem({ scores: { originality: 8, insight: 8, credibility: 8, composite: 8.27 } }),
    ]);
    expect(m.entries[0].score).toBe(8.3);
  });

  it("populates generatedAt with a Date.now()-class timestamp", async () => {
    const before = Date.now();
    const m = await buildManifest([makeItem()]);
    const after = Date.now();
    expect(m.generatedAt).toBeGreaterThanOrEqual(before);
    expect(m.generatedAt).toBeLessThanOrEqual(after);
  });

  it("returns empty entries when no items qualify", async () => {
    const m = await buildManifest([
      makeItem({ scores: { originality: 1, insight: 1, credibility: 1, composite: 1 } }),
    ]);
    expect(m.entries).toEqual([]);
  });

  it("handles unicode text (UTF-8 byte-level hashing)", async () => {
    const m = await buildManifest([
      makeItem({ text: "日本語のテキスト" }),
      makeItem({ text: "한국어 텍스트" }),
      makeItem({ text: "🚀 emoji content" }),
    ]);
    expect(m.entries).toHaveLength(3);
    for (const entry of m.entries) {
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    }
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

describe("diffManifest", () => {
  it("returns items the peer has not seen AND that share at least one topic", async () => {
    // Pre-compute the hash of "seen" so we can put it in the peer's manifest.
    const seenHash = (await buildManifest([makeItem({ text: "seen", topics: ["rust"] })])).entries[0].hash;
    const peerManifest = { entries: [{ hash: seenHash, topic: "rust", score: 9 }], generatedAt: 1 };
    const mine: ManifestableItem[] = [
      makeItem({ text: "seen", topics: ["rust"] }),
      makeItem({ text: "new1", topics: ["rust"] }),
      makeItem({ text: "newx", topics: ["unrelated"] }),
    ];
    const diff = await diffManifest(mine, peerManifest);
    expect(diff.map(d => d.text)).toEqual(["new1"]);
  });

  it("returns sorted by composite descending", async () => {
    const peerManifest = { entries: [{ hash: "x", topic: "rust", score: 9 }], generatedAt: 1 };
    const mine: ManifestableItem[] = [
      makeItem({ text: "a", topics: ["rust"], scores: { originality: 8, insight: 8, credibility: 8, composite: 7.5 } }),
      makeItem({ text: "b", topics: ["rust"], scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 } }),
      makeItem({ text: "c", topics: ["rust"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8.2 } }),
    ];
    const diff = await diffManifest(mine, peerManifest);
    expect(diff.map(d => d.text)).toEqual(["b", "c", "a"]);
  });

  it("returns empty when no candidates qualify", async () => {
    const peerManifest = { entries: [{ hash: "x", topic: "rust", score: 9 }], generatedAt: 1 };
    const diff = await diffManifest(
      [makeItem({ verdict: "slop", topics: ["rust"] })],
      peerManifest,
    );
    expect(diff).toEqual([]);
  });
});
