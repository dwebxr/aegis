/** In-memory cache: url → imageUrl (null = already checked, no OG image). TTL = 1 hour. */
const ogCache = new Map<string, { imageUrl: string | null; expiresAt: number }>();
const OG_CACHE_TTL = 60 * 60 * 1000;
const OG_CACHE_MAX = 500;

export function getOgCached(url: string): string | null | undefined {
  const entry = ogCache.get(url);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    ogCache.delete(url);
    return undefined;
  }
  return entry.imageUrl;
}

export function setOgCache(url: string, imageUrl: string | null): void {
  if (ogCache.size >= OG_CACHE_MAX) {
    const first = ogCache.keys().next().value;
    if (first !== undefined) ogCache.delete(first);
  }
  ogCache.set(url, { imageUrl, expiresAt: Date.now() + OG_CACHE_TTL });
}

export function _resetOgCache(): void {
  ogCache.clear();
}
