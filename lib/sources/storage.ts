import type { SavedSource } from "@/lib/types/sources";

const STORAGE_KEY_PREFIX = "aegis_sources_";

function storageKey(principalId: string): string {
  return `${STORAGE_KEY_PREFIX}${principalId}`;
}

export function loadSources(principalId: string): SavedSource[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(principalId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[sources] Failed to load source configs:", err);
    return [];
  }
}

export function saveSources(principalId: string, sources: SavedSource[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(storageKey(principalId), JSON.stringify(sources));
    return true;
  } catch (err) {
    console.warn("[sources] Failed to save source configs:", err);
    return false;
  }
}
