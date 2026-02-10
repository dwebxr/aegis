import { NextRequest, NextResponse } from "next/server";
import { decode } from "nostr-tools/nip19";
import type { AddressPointer } from "nostr-tools/nip19";
import { KIND_LONG_FORM, DEFAULT_RELAYS } from "@/lib/nostr/types";

export const maxDuration = 30;

/** Extra relays for long-form content that may not be in the naddr hint */
const LONG_FORM_RELAYS = [
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

export async function GET(request: NextRequest) {
  const naddr = request.nextUrl.searchParams.get("naddr");
  if (!naddr) {
    return NextResponse.json({ error: "naddr parameter required" }, { status: 400 });
  }

  let addr: AddressPointer;
  try {
    const decoded = decode(naddr);
    if (decoded.type !== "naddr") {
      return NextResponse.json({ error: "Invalid naddr" }, { status: 400 });
    }
    addr = decoded.data as AddressPointer;
    if (addr.kind !== KIND_LONG_FORM) {
      return NextResponse.json({ error: "Not a long-form event" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Failed to decode naddr" }, { status: 400 });
  }

  // Merge naddr relays + fallback relays, deduplicate
  const hintRelays = addr.relays && addr.relays.length > 0 ? addr.relays : DEFAULT_RELAYS;
  const relaySet = new Set([...hintRelays, ...LONG_FORM_RELAYS]);
  const relays = Array.from(relaySet);

  const { SimplePool, useWebSocketImplementation: setWsImpl } =
    await import("nostr-tools/pool");
  const WebSocket = (await import("ws")).default;
  setWsImpl(WebSocket as unknown as typeof globalThis.WebSocket);

  const pool = new SimplePool();
  const filter = {
    kinds: [addr.kind],
    authors: [addr.pubkey],
    "#d": [addr.identifier],
    limit: 1,
  };

  try {
    const events = await Promise.race([
      pool.querySync(relays, filter),
      new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 15000)),
    ]);

    if (events.length === 0) {
      return NextResponse.json(
        { error: "Event not found on relays", _debug: { relays, filter } },
        { status: 404 },
      );
    }

    const event = events[0];
    return NextResponse.json({
      content: event.content,
      tags: event.tags,
      pubkey: event.pubkey,
      created_at: event.created_at,
    });
  } catch (err) {
    console.error("[fetch/briefing] Relay query failed:", err);
    return NextResponse.json({ error: "Relay query failed" }, { status: 502 });
  } finally {
    pool.close(relays);
  }
}
