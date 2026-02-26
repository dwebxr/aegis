import type { SavedSource } from "@/lib/types/sources";
import { errMsg } from "@/lib/utils/errors";

const KEY_PREFIX = "aegis_sources_";

export function loadSources(principalId: string): SavedSource[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + principalId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedSource =>
        s &&
        typeof s.id === "string" &&
        (s.type === "rss" || s.type === "nostr" || s.type === "farcaster") &&
        typeof s.enabled === "boolean" &&
        typeof s.label === "string" &&
        typeof s.createdAt === "number",
    );
  } catch (err) {
    console.warn("[sources] Failed to load source configs:", errMsg(err));
    return [];
  }
}

export function saveSources(principalId: string, sources: SavedSource[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(KEY_PREFIX + principalId, JSON.stringify(sources));
    return true;
  } catch (err) {
    console.warn("[sources] Failed to save source configs:", errMsg(err));
    return false;
  }
}
