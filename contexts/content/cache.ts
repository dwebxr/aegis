import type { ContentItem } from "@/lib/types/content";
import { errMsg } from "@/lib/utils/errors";
import { isIDBAvailable, idbGet, idbPut, STORE_CONTENT_CACHE } from "@/lib/storage/idb";

const CONTENT_CACHE_KEY = "aegis-content-cache";
const IDB_CONTENT_KEY = "items";
const MAX_CACHED_ITEMS = 200;
const SAVE_DEBOUNCE_MS = 1000;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let useIDB = false;

function isFiniteInRange(v: unknown): boolean {
  return Number.isFinite(v) && (v as number) >= 0 && (v as number) <= 10;
}

function validateContentItems(parsed: unknown): ContentItem[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (c: unknown): c is ContentItem => {
      if (!c || typeof c !== "object") return false;
      const item = c as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        typeof item.text !== "string" ||
        typeof item.source !== "string" ||
        typeof item.createdAt !== "number" ||
        typeof item.verdict !== "string" ||
        typeof item.validated !== "boolean" ||
        typeof item.flagged !== "boolean" ||
        !item.scores || typeof item.scores !== "object"
      ) return false;
      const s = item.scores as Record<string, unknown>;
      return isFiniteInRange(s.composite) && isFiniteInRange(s.originality) &&
        isFiniteInRange(s.insight) && isFiniteInRange(s.credibility);
    },
  );
}

/** Truncate to MAX_CACHED_ITEMS but never drop validated or flagged items. */
export function truncatePreservingActioned(items: ContentItem[]): ContentItem[] {
  if (items.length <= MAX_CACHED_ITEMS) return items;

  const actioned: ContentItem[] = [];
  const unactioned: ContentItem[] = [];
  for (const item of items) {
    if (item.validated || item.flagged) {
      actioned.push(item);
    } else {
      unactioned.push(item);
    }
  }

  const unactionedBudget = Math.max(0, MAX_CACHED_ITEMS - actioned.length);
  const trimmedUnactioned = unactioned.slice(0, unactionedBudget);

  const preservedIds = new Set([
    ...actioned.map(c => c.id),
    ...trimmedUnactioned.map(c => c.id),
  ]);
  return items.filter(c => preservedIds.has(c.id));
}

export async function loadCachedContent(): Promise<ContentItem[]> {
  useIDB = isIDBAvailable();
  if (useIDB) {
    try {
      const data = await idbGet<unknown>(STORE_CONTENT_CACHE, IDB_CONTENT_KEY);
      if (data) return validateContentItems(data);
    } catch (err) {
      console.warn("[content] IDB load failed, trying localStorage:", errMsg(err));
    }
  }
  if (typeof globalThis.localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONTENT_CACHE_KEY);
    if (!raw) return [];
    return validateContentItems(JSON.parse(raw));
  } catch (err) {
    console.warn("[content] Failed to parse cached content:", errMsg(err));
    return [];
  }
}

export function saveCachedContent(items: ContentItem[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const truncated = truncatePreservingActioned(items);
    if (useIDB) {
      idbPut(STORE_CONTENT_CACHE, IDB_CONTENT_KEY, truncated).catch(err => {
        console.warn("[content] IDB save failed, falling back to localStorage:", errMsg(err));
        if (typeof globalThis.localStorage !== "undefined") {
          try {
            localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(truncated));
          } catch (lsErr) {
            console.error("[content] Both IDB and localStorage save failed:", errMsg(lsErr));
          }
        }
      });
    } else if (typeof globalThis.localStorage !== "undefined") {
      try {
        localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(truncated));
      } catch (err) {
        console.error("[content] localStorage save failed (quota?):", errMsg(err));
      }
    }
  }, SAVE_DEBOUNCE_MS);
}

export function _resetContentCache(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  useIDB = false;
}
