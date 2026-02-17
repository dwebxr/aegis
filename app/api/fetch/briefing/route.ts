import { NextRequest, NextResponse } from "next/server";
import { decode } from "nostr-tools/nip19";
import type { AddressPointer } from "nostr-tools/nip19";
import { KIND_LONG_FORM, mergeRelays } from "@/lib/nostr/types";
import { rateLimit } from "@/lib/api/rateLimit";
import { withTimeout } from "@/lib/utils/timeout";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, 30, 60_000);
  if (limited) return limited;

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

  const relays = mergeRelays(addr.relays);

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
    const events = await withTimeout(pool.querySync(relays, filter), 15000);

    if (events.length === 0) {
      return NextResponse.json(
        { error: "Event not found on relays" },
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
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "timeout") {
      return NextResponse.json({ error: "Relay query timed out" }, { status: 504 });
    }
    console.error("[fetch/briefing] Relay query failed:", err);
    return NextResponse.json({ error: "Relay query failed" }, { status: 502 });
  } finally {
    pool.close(relays);
  }
}
