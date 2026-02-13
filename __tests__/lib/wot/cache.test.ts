import { loadWoTCache, saveWoTCache, clearWoTCache } from "@/lib/wot/cache";
import type { WoTGraph } from "@/lib/wot/types";

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

  it("returns null when cache is empty", () => {
    expect(loadWoTCache()).toBeNull();
  });

  it("saves and loads a graph correctly", () => {
    const graph = makeGraph();
    saveWoTCache(graph, 3600000);
    const loaded = loadWoTCache();

    expect(loaded).not.toBeNull();
    expect(loaded!.userPubkey).toBe("user-pk");
    expect(loaded!.nodes.size).toBe(3);
    expect(loaded!.nodes.get("a")!.hopDistance).toBe(1);
    expect(loaded!.nodes.get("a")!.mutualFollows).toBe(2);
    expect(loaded!.maxHops).toBe(3);
  });

  it("preserves follows arrays through serialization", () => {
    const graph = makeGraph();
    saveWoTCache(graph, 3600000);
    const loaded = loadWoTCache()!;
    expect(loaded.nodes.get("user-pk")!.follows).toEqual(["a", "b"]);
  });

  it("returns null for expired cache", () => {
    const graph = makeGraph();
    saveWoTCache(graph, 1);

    // Manually set cachedAt to past
    const raw = JSON.parse(store["aegis-wot-graph"]);
    raw.cachedAt = Date.now() - 10000;
    store["aegis-wot-graph"] = JSON.stringify(raw);

    expect(loadWoTCache()).toBeNull();
    // Expired entry should be removed
    expect(store["aegis-wot-graph"]).toBeUndefined();
  });

  it("returns null for corrupted JSON", () => {
    store["aegis-wot-graph"] = "not valid json{{{";
    expect(loadWoTCache()).toBeNull();
  });

  it("clearWoTCache removes the entry", () => {
    const graph = makeGraph();
    saveWoTCache(graph, 3600000);
    expect(store["aegis-wot-graph"]).toBeDefined();
    clearWoTCache();
    expect(store["aegis-wot-graph"]).toBeUndefined();
  });

  it("handles missing localStorage gracefully", () => {
    delete (globalThis as Record<string, unknown>).localStorage;
    expect(loadWoTCache()).toBeNull();
    // Should not throw
    saveWoTCache(makeGraph(), 3600000);
    clearWoTCache();
  });
});
