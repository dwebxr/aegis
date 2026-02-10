import type { AddressPointer } from "nostr-tools/nip19";

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Server-side only: fetch a replaceable event by NIP-19 address pointer.
 * Uses `ws` for WebSocket in Node.js environment.
 */
export async function fetchEventByAddress(
  addr: AddressPointer,
  relayUrls: string[],
  timeoutMs = 12000,
): Promise<NostrEvent | null> {
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
      pool.querySync(relayUrls, filter),
      new Promise<never[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
    ]);

    if (events.length === 0) return null;
    return events[0] as unknown as NostrEvent;
  } catch (err) {
    console.error("[nostr/fetch] Failed to fetch event:", err);
    return null;
  } finally {
    pool.close(relayUrls);
  }
}
