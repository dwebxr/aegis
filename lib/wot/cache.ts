import type { WoTCacheEntry, WoTGraph } from "./types";

const WOT_CACHE_KEY = "aegis-wot-graph";

export function loadWoTCache(): WoTGraph | null {
  if (typeof globalThis.localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(WOT_CACHE_KEY);
    if (!raw) return null;
    const entry: WoTCacheEntry = JSON.parse(raw);
    if (Date.now() - entry.cachedAt > entry.ttl) {
      localStorage.removeItem(WOT_CACHE_KEY);
      return null;
    }
    const s = entry.graph;
    return { userPubkey: s.userPubkey, nodes: new Map(s.nodes), maxHops: s.maxHops, builtAt: s.builtAt };
  } catch {
    return null;
  }
}

export function saveWoTCache(graph: WoTGraph, ttl: number): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const entry: WoTCacheEntry = {
      graph: {
        userPubkey: graph.userPubkey,
        nodes: Array.from(graph.nodes.entries()),
        maxHops: graph.maxHops,
        builtAt: graph.builtAt,
      },
      cachedAt: Date.now(),
      ttl,
    };
    localStorage.setItem(WOT_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded — ignore
  }
}

export function clearWoTCache(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.removeItem(WOT_CACHE_KEY);
  } catch {}
}
