import type { WoTCacheEntry, WoTGraph } from "./types";
import { errMsg } from "@/lib/utils/errors";
import { isIDBAvailable, idbGet, idbPut, idbDelete, STORE_WOT_CACHE } from "@/lib/storage/idb";

const WOT_CACHE_KEY = "aegis-wot-graph";
const IDB_KEY = "graph";

export async function loadWoTCache(): Promise<WoTGraph | null> {
  // Try IDB first
  if (isIDBAvailable()) {
    try {
      const entry = await idbGet<WoTCacheEntry>(STORE_WOT_CACHE, IDB_KEY);
      if (entry) {
        if (Date.now() - entry.cachedAt > entry.ttl) {
          await idbDelete(STORE_WOT_CACHE, IDB_KEY);
          return null;
        }
        const s = entry.graph;
        return { userPubkey: s.userPubkey, nodes: new Map(s.nodes), maxHops: s.maxHops, builtAt: s.builtAt };
      }
    } catch (err) {
      console.warn("[wot-cache] IDB load failed, trying localStorage:", errMsg(err));
    }
  }

  // Fallback: localStorage
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
  } catch (err) {
    console.warn("[wot-cache] Failed to parse cached graph:", errMsg(err));
    return null;
  }
}

export async function saveWoTCache(graph: WoTGraph, ttl: number): Promise<void> {
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

  if (isIDBAvailable()) {
    try {
      await idbPut(STORE_WOT_CACHE, IDB_KEY, entry);
      return;
    } catch {
      console.debug("[wot-cache] IDB write failed, falling back to localStorage");
    }
  }

  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(WOT_CACHE_KEY, JSON.stringify(entry));
  } catch {
    console.debug("[wot-cache] localStorage write failed (quota exceeded?)");
  }
}

export async function clearWoTCache(): Promise<void> {
  if (isIDBAvailable()) {
    try {
      await idbDelete(STORE_WOT_CACHE, IDB_KEY);
    } catch {
      console.debug("[wot-cache] IDB delete failed");
    }
  }
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.removeItem(WOT_CACHE_KEY);
  } catch { console.debug("[wot-cache] localStorage unavailable"); }
}
