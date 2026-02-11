import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rateLimit";
import { errMsg } from "@/lib/utils/errors";
import { blockPrivateRelay } from "@/lib/utils/url";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }
  const { relays, pubkeys, hashtags, limit = 20, since } = body;

  if (!relays || !Array.isArray(relays) || relays.length === 0) {
    return NextResponse.json({ error: "At least one relay URL is required" }, { status: 400 });
  }

  for (const relay of relays) {
    if (typeof relay !== "string") {
      return NextResponse.json({ error: `Invalid relay URL: must be a string` }, { status: 400 });
    }
    const blocked = blockPrivateRelay(relay);
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 400 });
    }
  }

  let SimplePool: typeof import("nostr-tools/pool").SimplePool;
  let setWsImpl: typeof import("nostr-tools/pool").useWebSocketImplementation;
  try {
    const poolModule = await import("nostr-tools/pool");
    SimplePool = poolModule.SimplePool;
    setWsImpl = poolModule.useWebSocketImplementation;
  } catch (err) {
    console.error("[fetch/nostr] Failed to load nostr-tools:", err);
    return NextResponse.json({ error: "Failed to load Nostr tools" }, { status: 500 });
  }

  const WebSocket = (await import("ws")).default;
  setWsImpl(WebSocket as unknown as typeof globalThis.WebSocket);

  const pool = new SimplePool();

  const filter: { kinds: number[]; limit: number; authors?: string[]; "#t"?: string[]; since?: number } = {
    kinds: [1],
    limit: Math.min(limit, 100),
  };

  if (pubkeys && Array.isArray(pubkeys) && pubkeys.length > 0) {
    filter.authors = pubkeys;
  }

  if (hashtags && Array.isArray(hashtags) && hashtags.length > 0) {
    filter["#t"] = hashtags;
  }

  if (since && typeof since === "number") {
    filter.since = since;
  }

  try {
    const rawEvents = await Promise.race([
      pool.querySync(relays, filter),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);

    rawEvents.sort((a, b) => b.created_at - a.created_at);

    // Fetch Kind 0 profiles for authors
    const uniquePubkeys = Array.from(new Set(rawEvents.map(e => e.pubkey)));
    const profiles: Record<string, { name?: string; picture?: string }> = {};
    if (uniquePubkeys.length > 0) {
      try {
        const metaEvents = await Promise.race([
          pool.querySync(relays, { kinds: [0], authors: uniquePubkeys.slice(0, 50) }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("meta-timeout")), 5000)),
        ]);
        for (const me of metaEvents) {
          if (profiles[me.pubkey]) continue; // keep first (most relays agree on)
          try {
            const meta = JSON.parse(me.content);
            profiles[me.pubkey] = {
              name: meta.display_name || meta.name || undefined,
              picture: meta.picture || undefined,
            };
          } catch { /* invalid metadata JSON */ }
        }
      } catch {
        // Timeout fetching profiles — not critical, continue without them
      }
    }

    return NextResponse.json({
      events: rawEvents.map(e => ({
        id: e.id,
        pubkey: e.pubkey,
        content: e.content,
        createdAt: e.created_at,
        tags: e.tags,
      })),
      profiles,
    });
  } catch (err: unknown) {
    console.error("[fetch/nostr] Relay query failed:", err);
    const msg = errMsg(err);
    if (msg === "timeout") {
      return NextResponse.json({
        events: [],
        warning: "Request timed out. Try fewer relays or a more specific filter.",
      });
    }
    return NextResponse.json({ error: `Failed to query relays: ${msg}` }, { status: 502 });
  } finally {
    pool.close(relays);
  }
}
