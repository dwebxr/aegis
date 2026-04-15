/**
 * buildManifestAsync exercises the SubtleCrypto path. Node 20+ ships
 * crypto.subtle natively, so this hits real SHA-256, not a mock.
 */

import { webcrypto } from "node:crypto";
import { buildManifestAsync, type ManifestableItem } from "../src/manifest";
import { MIN_OFFER_SCORE } from "../src/protocol";

// jsdom-free Node test env doesn't expose crypto.subtle on the global by
// default in older Jest setups; explicitly install it.
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

describe("buildManifestAsync — real SubtleCrypto SHA-256", () => {
  it("produces 64-char lowercase hex hashes", async () => {
    const m = await buildManifestAsync([makeItem({ text: "hello world" })]);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes match the documented SHA-256 of the canonical text", async () => {
    // Known SHA-256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    const m = await buildManifestAsync([makeItem({ text: "hello world" })]);
    expect(m.entries[0].hash).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("produces stable hashes across calls (same input → same output)", async () => {
    const a = await buildManifestAsync([makeItem({ text: "stable" })]);
    const b = await buildManifestAsync([makeItem({ text: "stable" })]);
    expect(a.entries[0].hash).toBe(b.entries[0].hash);
  });

  it("filters out below-threshold + slop + topicless items", async () => {
    const items = [
      makeItem({ text: "in", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ text: "lo", scores: { originality: 5, insight: 5, credibility: 5, composite: MIN_OFFER_SCORE - 0.5 } }),
      makeItem({ text: "sl", verdict: "slop", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ text: "no", topics: [], scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    ];
    const m = await buildManifestAsync(items);
    expect(m.entries.map(e => e.topic)).toEqual(["tech"]);
  });

  it("handles parallel hashing of many items without collision or order corruption", async () => {
    const items: ManifestableItem[] = Array.from({ length: 30 }, (_, i) =>
      makeItem({ text: `unique-${i}`, scores: { originality: 8, insight: 8, credibility: 8, composite: 7 + (i % 3) } }),
    );
    const m = await buildManifestAsync(items);
    const hashes = new Set(m.entries.map(e => e.hash));
    expect(hashes.size).toBe(m.entries.length); // all unique
    // Sorted by composite descending.
    for (let i = 1; i < m.entries.length; i++) {
      expect(m.entries[i - 1].score).toBeGreaterThanOrEqual(m.entries[i].score);
    }
  });

  it("populates generatedAt with a Date.now()-class timestamp", async () => {
    const before = Date.now();
    const m = await buildManifestAsync([makeItem()]);
    const after = Date.now();
    expect(m.generatedAt).toBeGreaterThanOrEqual(before);
    expect(m.generatedAt).toBeLessThanOrEqual(after);
  });

  it("returns an empty entries array when no items qualify", async () => {
    const m = await buildManifestAsync([
      makeItem({ scores: { originality: 1, insight: 1, credibility: 1, composite: 1 } }),
    ]);
    expect(m.entries).toEqual([]);
  });

  it("handles unicode text (UTF-8 byte-level hashing)", async () => {
    const m = await buildManifestAsync([
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
