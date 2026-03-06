import { errMsg } from "@/lib/utils/errors";

export interface RawItem {
  text: string;
  author: string;
  avatar?: string;
  sourceUrl?: string;
  imageUrl?: string;
  nostrPubkey?: string;
}

export interface FetcherCallbacks {
  handleFetchError: (res: Response, key: string) => void;
  recordSourceError: (key: string, error: string) => void;
}

export type HttpCacheHeaders = Map<string, { etag?: string; lastModified?: string }>;

const MAX_TEXT_LENGTH = 2000;

export async function fetchRSS(
  feedUrl: string,
  key: string,
  httpCacheHeaders: HttpCacheHeaders,
  cb: FetcherCallbacks,
): Promise<RawItem[]> {
  try {
    const body: Record<string, unknown> = { feedUrl, limit: 10 };
    const cached = httpCacheHeaders.get(key);
    if (cached?.etag) body.etag = cached.etag;
    if (cached?.lastModified) body.lastModified = cached.lastModified;

    const res = await fetch("/api/fetch/rss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      cb.handleFetchError(res, key);
      return [];
    }
    const data = await res.json();

    if (data.etag || data.lastModified) {
      httpCacheHeaders.set(key, { etag: data.etag, lastModified: data.lastModified });
    }

    if (data.notModified) return [];

    return (data.items || []).map((item: { title: string; content: string; author?: string; link?: string; imageUrl?: string }) => ({
      text: `${item.title}\n\n${item.content}`.slice(0, MAX_TEXT_LENGTH),
      author: item.author || data.feedTitle || "RSS",
      sourceUrl: item.link,
      imageUrl: item.imageUrl,
    }));
  } catch (err) {
    const msg = errMsg(err);
    console.error("[scheduler] RSS fetch failed:", msg);
    cb.recordSourceError(key, msg);
    return [];
  }
}

export async function fetchNostr(
  relays: string[],
  pubkeys: string[] | undefined,
  key: string,
  cb: FetcherCallbacks,
): Promise<RawItem[]> {
  try {
    const validPubkeys = pubkeys?.filter(Boolean);
    const res = await fetch("/api/fetch/nostr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relays, pubkeys: validPubkeys?.length ? validPubkeys : undefined, limit: 20 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      cb.handleFetchError(res, key);
      return [];
    }
    const data = await res.json();
    const profiles: Record<string, { name?: string; picture?: string }> = data.profiles || {};
    return (data.events || []).map((ev: { content: string; pubkey: string; id: string }) => {
      const profile = profiles[ev.pubkey];
      return {
        text: ev.content.slice(0, MAX_TEXT_LENGTH),
        author: profile?.name || ev.pubkey.slice(0, 12) + "...",
        avatar: profile?.picture,
        sourceUrl: `nostr:${ev.id}`,
        nostrPubkey: ev.pubkey,
      };
    });
  } catch (err) {
    const msg = errMsg(err);
    console.error("[scheduler] Nostr fetch failed:", msg);
    cb.recordSourceError(key, msg);
    return [];
  }
}

export async function fetchURL(
  url: string,
  key: string,
  cb: FetcherCallbacks,
): Promise<RawItem[]> {
  try {
    const res = await fetch("/api/fetch/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      cb.handleFetchError(res, key);
      return [];
    }
    const data = await res.json();
    let hostname = "unknown";
    try { hostname = new URL(url).hostname; } catch (e) { console.warn("[scheduler] Malformed URL:", url, e); }
    return [{
      text: `${data.title || ""}\n\n${data.content || ""}`.slice(0, MAX_TEXT_LENGTH),
      author: data.author || hostname,
      sourceUrl: url,
      imageUrl: data.imageUrl,
    }];
  } catch (err) {
    const msg = errMsg(err);
    console.error("[scheduler] URL fetch failed:", msg);
    cb.recordSourceError(key, msg);
    return [];
  }
}

export async function fetchFarcaster(
  fid: string,
  username: string,
  key: string,
  cb: FetcherCallbacks,
): Promise<RawItem[]> {
  try {
    const res = await fetch("/api/fetch/farcaster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "feed", fid: Number(fid), limit: 20 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      cb.handleFetchError(res, key);
      return [];
    }
    const data = await res.json();
    return (data.items || []).map((item: { text: string; author: string; avatar?: string; sourceUrl?: string; imageUrl?: string }) => ({
      text: item.text.slice(0, MAX_TEXT_LENGTH),
      author: item.author || username || `fid:${fid}`,
      avatar: item.avatar,
      sourceUrl: item.sourceUrl,
      imageUrl: item.imageUrl,
    }));
  } catch (err) {
    const msg = errMsg(err);
    console.error("[scheduler] Farcaster fetch failed:", msg);
    cb.recordSourceError(key, msg);
    return [];
  }
}
