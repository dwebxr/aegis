/**
 * @jest-environment jsdom
 *
 * Principal-scoped cache isolation — fix for the cross-account leak where
 * User A's IDB/localStorage cache could be read by User B on the same browser.
 *
 * Exercises the real IDB layer (via fake-indexeddb/auto) so it catches both
 * key construction bugs and storage-layer regressions, not just function-call
 * shape. Anonymous (null/undefined) and named principals share a store but
 * never overlap.
 */
import "fake-indexeddb/auto";
import {
  loadCachedContent,
  saveCachedContent,
  clearCachedContent,
  _resetContentCache,
} from "@/contexts/content/cache";
import type { ContentItem } from "@/lib/types/content";

function makeItem(id: string, overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id,
    owner: "anyone",
    author: "a",
    avatar: "",
    text: `content-${id}`,
    source: "rss",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "",
    createdAt: 1_700_000_000_000,
    validated: false,
    flagged: false,
    timestamp: "1m ago",
    ...overrides,
  };
}

// Save() debounces by 1s — flush by waiting.
async function flushSave() {
  await new Promise((r) => setTimeout(r, 1100));
}

beforeEach(async () => {
  _resetContentCache();
  // fake-indexeddb has a global state — null out the DB between tests.
  // The simplest way: clear all known keys we might touch.
  if (typeof globalThis.localStorage !== "undefined") {
    localStorage.clear();
  }
  // IDB clear: open a transaction and clear the store. The cache module's
  // internal _resetContentCache flips useIDB back to detected on next load.
  await clearCachedContent("alice");
  await clearCachedContent("bob");
  await clearCachedContent(null);
  await clearCachedContent("anon");
});

describe("loadCachedContent / saveCachedContent — principal isolation", () => {
  it("alice and bob have independent caches in the same store", async () => {
    const aliceItems = [makeItem("a1"), makeItem("a2")];
    const bobItems = [makeItem("b1")];

    saveCachedContent(aliceItems, "alice");
    await flushSave();
    saveCachedContent(bobItems, "bob");
    await flushSave();

    const aliceLoaded = await loadCachedContent("alice");
    const bobLoaded = await loadCachedContent("bob");

    expect(aliceLoaded.map((i) => i.id).sort()).toEqual(["a1", "a2"]);
    expect(bobLoaded.map((i) => i.id)).toEqual(["b1"]);
  });

  it("alice's writes do not leak into anonymous load", async () => {
    saveCachedContent([makeItem("a1")], "alice");
    await flushSave();
    const anonLoaded = await loadCachedContent(null);
    expect(anonLoaded).toEqual([]);
  });

  it("undefined principal and null principal share the 'anon' bucket", async () => {
    saveCachedContent([makeItem("u1")]); // no principal arg
    await flushSave();
    const explicitNull = await loadCachedContent(null);
    expect(explicitNull.map((i) => i.id)).toEqual(["u1"]);
  });

  it("returns [] for a principal that has never written", async () => {
    expect(await loadCachedContent("ghost")).toEqual([]);
  });

  it("clearCachedContent removes only the named principal's bucket", async () => {
    saveCachedContent([makeItem("a1")], "alice");
    saveCachedContent([makeItem("b1")], "bob");
    await flushSave();

    await clearCachedContent("alice");

    expect(await loadCachedContent("alice")).toEqual([]);
    expect((await loadCachedContent("bob")).map((i) => i.id)).toEqual(["b1"]);
  });

  it("clearCachedContent also purges legacy unscoped keys (cross-account safety)", async () => {
    // Simulate a pre-migration localStorage write under the legacy key. New code
    // should drop it on clear so it can't be picked up by any future principal.
    localStorage.setItem("aegis-content-cache", JSON.stringify([makeItem("legacy")]));
    await clearCachedContent("alice");
    expect(localStorage.getItem("aegis-content-cache")).toBeNull();
  });

  it("validates loaded data — corrupt entries for one principal do not poison another", async () => {
    localStorage.setItem("aegis-content-cache:alice", JSON.stringify([{ broken: "junk" }]));
    saveCachedContent([makeItem("b1")], "bob");
    await flushSave();

    expect(await loadCachedContent("alice")).toEqual([]); // invalid → filtered
    expect((await loadCachedContent("bob")).map((i) => i.id)).toEqual(["b1"]);
  });
});

describe("saveCachedContent — debounce + truncation are per-call, not per-principal", () => {
  it("rapid saves under different principals — last one wins per-bucket", async () => {
    saveCachedContent([makeItem("a-old")], "alice");
    saveCachedContent([makeItem("a-new")], "alice"); // cancels previous debounce
    await flushSave();
    expect((await loadCachedContent("alice")).map((i) => i.id)).toEqual(["a-new"]);
  });

  it("rapid saves alternating principals: the LAST debounced save wins under its key", async () => {
    // saveCachedContent uses a single shared debounce timer; the last call's
    // key is the one that gets written. The earlier principal's write is dropped.
    // This is a known limitation worth pinning so a future refactor (per-principal
    // timers) can be made deliberately.
    saveCachedContent([makeItem("a1")], "alice");
    saveCachedContent([makeItem("b1")], "bob"); // wins
    await flushSave();
    expect(await loadCachedContent("alice")).toEqual([]);
    expect((await loadCachedContent("bob")).map((i) => i.id)).toEqual(["b1"]);
  });
});
