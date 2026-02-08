import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
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
    if (typeof relay !== "string" || !relay.startsWith("wss://")) {
      return NextResponse.json({ error: `Invalid relay URL: ${relay}. Must start with wss://` }, { status: 400 });
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

  let events: Array<{ id: string; pubkey: string; content: string; created_at: number; tags: string[][] }> = [];

  try {
    const rawEvents = await Promise.race([
      pool.querySync(relays, filter),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);

    events = rawEvents.map(e => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      created_at: e.created_at,
      tags: e.tags,
    }));
  } catch (err: unknown) {
    console.error("[fetch/nostr] Relay query failed:", err);
    const msg = err instanceof Error ? err.message : "";
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

  events.sort((a, b) => b.created_at - a.created_at);

  return NextResponse.json({
    events: events.map(e => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      createdAt: e.created_at,
      tags: e.tags,
    })),
  });
}
