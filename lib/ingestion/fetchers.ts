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
const FETCH_TIMEOUT_MS = 30_000;

// `onData` runs after JSON parse, before `map` — callers (e.g. fetchRSS) use it to refresh
// ETag/Last-Modified state and short-circuit on 304-style `notModified` envelopes.
async function postToApi<T>(opts: {
  endpoint: string;
  body: unknown;
  key: string;
  cb: FetcherCallbacks;
  label: string;
  map: (data: T) => RawItem[];
  onData?: (data: T) => { shortCircuit: true } | undefined;
}): Promise<RawItem[]> {
  try {
    const res = await fetch(opts.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      opts.cb.handleFetchError(res, opts.key);
      return [];
    }
    const data = await res.json() as T;
    const early = opts.onData?.(data);
    if (early?.shortCircuit) return [];
    return opts.map(data);
  } catch (err) {
    const msg = errMsg(err);
    console.error(`[scheduler] ${opts.label} fetch failed:`, msg);
    opts.cb.recordSourceError(opts.key, msg);
    return [];
  }
}

export async function fetchRSS(
  feedUrl: string,
  key: string,
  httpCacheHeaders: HttpCacheHeaders,
  cb: FetcherCallbacks,
): Promise<RawItem[]> {
  const body: { feedUrl: string; limit: number; etag?: string; lastModified?: string } = { feedUrl, limit: 10 };
  const cached = httpCacheHeaders.get(key);
  if (cached?.etag) body.etag = cached.etag;
  if (cached?.lastModified) body.lastModified = cached.lastModified;

  type RssResponse = {
    feedTitle?: string;
    etag?: string;
    lastModified?: string;
    notModified?: boolean;
    items?: Array<{ title: string; content: string; author?: string; link?: string; imageUrl?: string }>;
  };

  return postToApi<RssResponse>({
    endpoint: "/api/fetch/rss",
    body,
    key,
    cb,
    label: "RSS",
    onData: (data) => {
      if (data.etag || data.lastModified) {
        httpCacheHeaders.set(key, { etag: data.etag, lastModified: data.lastModified });
      }
      if (data.notModified) return { shortCircuit: true };
      return undefined;
    },
    map: (data) => (data.items || []).map(item => ({
      text: `${item.title}\n\n${item.content}`.slice(0, MAX_TEXT_LENGTH),
      author: item.author || data.feedTitle || "RSS",
      sourceUrl: item.link,
      imageUrl: item.imageUrl,
    })),
  });
}

export async function fetchNostr(
  relays: string[],
  pubkeys: string[] | undefined,
  key: string,
  cb: FetcherCallbacks,
): Promise<RawItem[]> {
  const validPubkeys = pubkeys?.filter(Boolean);

  type NostrResponse = {
    events?: Array<{ content: string; pubkey: string; id: string }>;
    profiles?: Record<string, { name?: string; picture?: string }>;
  };

  return postToApi<NostrResponse>({
    endpoint: "/api/fetch/nostr",
    body: { relays, pubkeys: validPubkeys?.length ? validPubkeys : undefined, limit: 20 },
    key,
    cb,
    label: "Nostr",
    map: (data) => {
      const profiles = data.profiles || {};
      return (data.events || []).map(ev => {
        const profile = profiles[ev.pubkey];
        return {
          text: ev.content.slice(0, MAX_TEXT_LENGTH),
          author: profile?.name || ev.pubkey.slice(0, 12) + "...",
          avatar: profile?.picture,
          sourceUrl: `nostr:${ev.id}`,
          nostrPubkey: ev.pubkey,
        };
      });
    },
  });
}

export async function fetchURL(
  url: string,
  key: string,
  cb: FetcherCallbacks,
): Promise<RawItem[]> {
  let hostname = "unknown";
  try { hostname = new URL(url).hostname; } catch (e) { console.warn("[scheduler] Malformed URL:", url, e); }

  type UrlResponse = { title?: string; content?: string; author?: string; imageUrl?: string };

  return postToApi<UrlResponse>({
    endpoint: "/api/fetch/url",
    body: { url },
    key,
    cb,
    label: "URL",
    map: (data) => [{
      text: `${data.title || ""}\n\n${data.content || ""}`.slice(0, MAX_TEXT_LENGTH),
      author: data.author || hostname,
      sourceUrl: url,
      imageUrl: data.imageUrl,
    }],
  });
}

export async function fetchFarcaster(
  fid: string,
  username: string,
  key: string,
  cb: FetcherCallbacks,
): Promise<RawItem[]> {
  const numericFid = Number(fid);
  if (!Number.isFinite(numericFid)) {
    cb.recordSourceError(key, `Invalid fid: ${fid}`);
    return [];
  }

  type FarcasterResponse = {
    items?: Array<{ text: string; author: string; avatar?: string; sourceUrl?: string; imageUrl?: string }>;
  };

  return postToApi<FarcasterResponse>({
    endpoint: "/api/fetch/farcaster",
    body: { action: "feed", fid: numericFid, limit: 20 },
    key,
    cb,
    label: "Farcaster",
    map: (data) => (data.items || []).map(item => ({
      text: item.text.slice(0, MAX_TEXT_LENGTH),
      author: item.author || username || `fid:${fid}`,
      avatar: item.avatar,
      sourceUrl: item.sourceUrl,
      imageUrl: item.imageUrl,
    })),
  });
}
