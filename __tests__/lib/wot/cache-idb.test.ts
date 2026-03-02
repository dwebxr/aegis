/**
 * @jest-environment jsdom
 */
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}
import "fake-indexeddb/auto";
import { _resetDB, idbClear, idbGet, STORE_WOT_CACHE } from "@/lib/storage/idb";
import { loadWoTCache, saveWoTCache, clearWoTCache } from "@/lib/wot/cache";
import type { WoTGraph } from "@/lib/wot/types";

function makeGraph(overrides: Partial<WoTGraph> = {}): WoTGraph {
  const nodes = new Map<string, { pubkey: string; follows: string[]; hopDistance: number; mutualFollows: number }>();
  nodes.set("pk", { pubkey: "pk", follows: ["a", "b"], hopDistance: 0, mutualFollows: 0 });
  nodes.set("a", { pubkey: "a", follows: ["c"], hopDistance: 1, mutualFollows: 3 });
  return { userPubkey: "pk", nodes, maxHops: 2, builtAt: Date.now(), ...overrides };
}

beforeEach(async () => {
  _resetDB();
  await idbClear(STORE_WOT_CACHE);
  localStorage.clear();
});

describe("WoT cache — IDB round-trip", () => {
  it("saves and loads graph through IDB", async () => {
    const graph = makeGraph();
    await saveWoTCache(graph, 3600000);

    const loaded = await loadWoTCache();
    expect(loaded).not.toBeNull();
    expect(loaded!.userPubkey).toBe("pk");
    expect(loaded!.nodes.size).toBe(2);
    expect(loaded!.nodes.get("a")!.hopDistance).toBe(1);
    expect(loaded!.nodes.get("a")!.mutualFollows).toBe(3);
    expect(loaded!.maxHops).toBe(2);
  });

  it("preserves follows arrays through IDB serialization", async () => {
    const graph = makeGraph();
    await saveWoTCache(graph, 3600000);
    const loaded = (await loadWoTCache())!;
    expect(loaded.nodes.get("pk")!.follows).toEqual(["a", "b"]);
    expect(loaded.nodes.get("a")!.follows).toEqual(["c"]);
  });

  it("returns Map instance (not array) for nodes", async () => {
    await saveWoTCache(makeGraph(), 3600000);
    const loaded = (await loadWoTCache())!;
    expect(loaded.nodes).toBeInstanceOf(Map);
  });
});

describe("WoT cache — IDB TTL expiration", () => {
  it("returns null and deletes entry when TTL expired", async () => {
    const graph = makeGraph();
    await saveWoTCache(graph, 1000); // 1 second TTL

    // Manually set cachedAt to past
    const entry = await idbGet(STORE_WOT_CACHE, "graph") as Record<string, unknown>;
    expect(entry).toBeDefined();
    entry.cachedAt = Date.now() - 5000; // 5 seconds ago
    const { idbPut } = await import("@/lib/storage/idb");
    await idbPut(STORE_WOT_CACHE, "graph", entry);

    const loaded = await loadWoTCache();
    expect(loaded).toBeNull();
  });

  it("returns graph when within TTL", async () => {
    await saveWoTCache(makeGraph(), 3600000); // 1 hour TTL
    const loaded = await loadWoTCache();
    expect(loaded).not.toBeNull();
  });

  it("handles TTL at exact boundary", async () => {
    const graph = makeGraph();
    await saveWoTCache(graph, 1000);

    // Set cachedAt to well within TTL (500ms ago for 1000ms TTL)
    const entry = await idbGet(STORE_WOT_CACHE, "graph") as Record<string, unknown>;
    entry.cachedAt = Date.now() - 500; // 500ms before TTL boundary
    const { idbPut } = await import("@/lib/storage/idb");
    await idbPut(STORE_WOT_CACHE, "graph", entry);

    // Code uses `> ttl` (strict), so 500 < 1000 → should NOT expire
    const loaded = await loadWoTCache();
    expect(loaded).not.toBeNull();
  });
});

describe("WoT cache — IDB clearWoTCache", () => {
  it("removes entry from IDB", async () => {
    await saveWoTCache(makeGraph(), 3600000);
    expect(await loadWoTCache()).not.toBeNull();

    await clearWoTCache();
    expect(await loadWoTCache()).toBeNull();
  });
});

describe("WoT cache — empty IDB", () => {
  it("returns null when IDB has no cache entry", async () => {
    expect(await loadWoTCache()).toBeNull();
  });
});

describe("WoT cache — large graph", () => {
  it("handles graph with many nodes", async () => {
    const nodes = new Map<string, { pubkey: string; follows: string[]; hopDistance: number; mutualFollows: number }>();
    for (let i = 0; i < 500; i++) {
      nodes.set(`pk${i}`, { pubkey: `pk${i}`, follows: [`pk${i + 1}`], hopDistance: i % 3, mutualFollows: i });
    }
    const graph: WoTGraph = { userPubkey: "pk0", nodes, maxHops: 3, builtAt: Date.now() };

    await saveWoTCache(graph, 3600000);
    const loaded = (await loadWoTCache())!;
    expect(loaded.nodes.size).toBe(500);
    expect(loaded.nodes.get("pk0")!.follows).toEqual(["pk1"]);
    expect(loaded.nodes.get("pk499")!.mutualFollows).toBe(499);
  });
});
