/**
 * @jest-environment jsdom
 */
import { loadWoTCache, saveWoTCache, clearWoTCache } from "@/lib/wot/cache";
import type { WoTGraph } from "@/lib/wot/types";

// Mock IDB as unavailable so tests use localStorage path
jest.mock("@/lib/storage/idb", () => ({
  isIDBAvailable: () => false,
  idbGet: jest.fn(),
  idbPut: jest.fn(),
  idbDelete: jest.fn(),
  STORE_WOT_CACHE: "wot-cache",
}));

function makeGraph(): WoTGraph {
  const nodes = new Map();
  nodes.set("user-pk", { pubkey: "user-pk", follows: ["a", "b"], hopDistance: 0, mutualFollows: 0 });
  nodes.set("a", { pubkey: "a", follows: [], hopDistance: 1, mutualFollows: 2 });
  nodes.set("b", { pubkey: "b", follows: [], hopDistance: 1, mutualFollows: 1 });
  return { userPubkey: "user-pk", nodes, maxHops: 3, builtAt: Date.now() };
}

describe("WoT cache", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const mockStorage = {
      getItem: jest.fn((key: string) => store[key] ?? null),
      setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: jest.fn((key: string) => { delete store[key]; }),
      clear: jest.fn(() => { store = {}; }),
      get length() { return Object.keys(store).length; },
      key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
    };
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true, configurable: true });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("returns null when cache is empty", async () => {
    expect(await loadWoTCache()).toBeNull();
  });

  it("saves and loads a graph correctly", async () => {
    const graph = makeGraph();
    await saveWoTCache(graph, 3600000);
    const loaded = await loadWoTCache();

    expect(loaded).not.toBeNull();
    expect(loaded!.userPubkey).toBe("user-pk");
    expect(loaded!.nodes.size).toBe(3);
    expect(loaded!.nodes.get("a")!.hopDistance).toBe(1);
    expect(loaded!.nodes.get("a")!.mutualFollows).toBe(2);
    expect(loaded!.maxHops).toBe(3);
  });

  it("preserves follows arrays through serialization", async () => {
    const graph = makeGraph();
    await saveWoTCache(graph, 3600000);
    const loaded = (await loadWoTCache())!;
    expect(loaded.nodes.get("user-pk")!.follows).toEqual(["a", "b"]);
  });

  it("returns null for expired cache", async () => {
    const graph = makeGraph();
    await saveWoTCache(graph, 1);

    // Manually set cachedAt to past
    const raw = JSON.parse(store["aegis-wot-graph"]);
    raw.cachedAt = Date.now() - 10000;
    store["aegis-wot-graph"] = JSON.stringify(raw);

    expect(await loadWoTCache()).toBeNull();
    // Expired entry should be removed
    expect(store["aegis-wot-graph"]).toBeUndefined();
  });

  it("returns null for corrupted JSON", async () => {
    store["aegis-wot-graph"] = "not valid json{{{";
    expect(await loadWoTCache()).toBeNull();
  });

  it("clearWoTCache removes the entry", async () => {
    const graph = makeGraph();
    await saveWoTCache(graph, 3600000);
    expect(store["aegis-wot-graph"]).toBeDefined();
    await clearWoTCache();
    expect(store["aegis-wot-graph"]).toBeUndefined();
  });

  it("handles missing localStorage gracefully", async () => {
    delete (globalThis as Record<string, unknown>).localStorage;
    expect(await loadWoTCache()).toBeNull();
    // Should not throw
    await saveWoTCache(makeGraph(), 3600000);
    await clearWoTCache();
  });
});
