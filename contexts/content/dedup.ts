import type { ContentItem } from "@/lib/types/content";

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "fbclid", "gclid", "mc_cid", "mc_eid",
]);

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hostname = url.hostname.replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    for (const key of Array.from(url.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hash = "";
    return url.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Build a dedup index (Set of normalized URLs + Set of texts) from an array of items. */
function buildDedupIndex(items: ContentItem[]): { urls: Set<string>; texts: Set<string> } {
  const urls = new Set<string>();
  const texts = new Set<string>();
  for (const c of items) {
    if (c.sourceUrl) urls.add(normalizeUrl(c.sourceUrl));
    texts.add(c.text);
  }
  return { urls, texts };
}

/** Check if a single item is a duplicate against an existing array. O(n) — use for single-item checks only. */
export function isDuplicateItem(item: ContentItem, existing: ContentItem[]): boolean {
  const normUrl = item.sourceUrl ? normalizeUrl(item.sourceUrl) : null;

  return existing.some(c => {
    if (normUrl && c.sourceUrl && normUrl === normalizeUrl(c.sourceUrl)) {
      return true;
    }
    if (c.text === item.text) {
      return true;
    }
    return false;
  });
}

/** Filter `candidates` to only those not already present in `existing`. O(n+m) via pre-built index. */
export function filterNewItems(candidates: ContentItem[], existing: ContentItem[]): ContentItem[] {
  const { urls, texts } = buildDedupIndex(existing);
  return candidates.filter(item => {
    if (item.sourceUrl && urls.has(normalizeUrl(item.sourceUrl))) return false;
    if (texts.has(item.text)) return false;
    return true;
  });
}

/** Dedup an array of ContentItems, keeping the first occurrence. Matches by normalized URL OR exact text. */
export function deduplicateItems(items: ContentItem[]): ContentItem[] {
  const seenUrls = new Set<string>();
  const seenTexts = new Set<string>();
  const result: ContentItem[] = [];

  for (const item of items) {
    const norm = item.sourceUrl ? normalizeUrl(item.sourceUrl) : null;
    if (norm && seenUrls.has(norm)) continue;
    if (seenTexts.has(item.text)) continue;

    if (norm) seenUrls.add(norm);
    seenTexts.add(item.text);
    result.push(item);
  }

  return result;
}
