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
  timeoutMs = 8000,
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
  };

  try {
    const event = await Promise.race([
      pool.get(relayUrls, filter),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);

    return event as NostrEvent | null;
  } catch (err) {
    console.error("[nostr/fetch] Failed to fetch event:", err);
    return null;
  } finally {
    pool.close(relayUrls);
  }
}
