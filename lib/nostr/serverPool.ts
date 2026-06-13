import "server-only";
import { isIP } from "node:net";
import { checkPrivateAddress, makePrivateIPRejectingLookup } from "../utils/ssrf";

// Server-only: nostr-tools/pool + ws are dynamically imported in loadServerPool
// to keep them out of edge bundles. Caller owns lifecycle (pool.close/destroy).
//
// SSRF defense for relay WebSockets is enforced at *connection* time, not via a
// hostname-string pre-check: a pre-check resolves DNS separately from the socket
// and is bypassable by DNS rebinding / IPv4-mapped IPv6 literals. SecureWS below
// (1) rejects non-wss:// and literal private-IP relays in the constructor —
// net.connect skips the `lookup` hook for IP literals, so they must be caught
// here — and (2) pins hostnames to a single validated address via `lookup`.

// Throws if the relay URL is not wss:// or its host is a literal private/reserved
// IP. Exported for unit testing.
export function assertRelayUrlAllowed(rawUrl: string): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid relay URL");
  }
  if (u.protocol !== "wss:") {
    throw new Error(`Relay must use wss:// (got ${u.protocol})`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const fam = isIP(host);
  if (fam !== 0) {
    const bad = checkPrivateAddress(host, fam);
    if (bad) throw new Error(`SSRF blocked: relay host ${host} — ${bad}`);
  }
}

export async function loadServerPool(): Promise<import("nostr-tools/pool").SimplePool> {
  // Rebind useWebSocketImplementation → setWsImpl: the `use` prefix trips react-hooks/rules-of-hooks.
  const { SimplePool, useWebSocketImplementation: setWsImpl } = await import("nostr-tools/pool");
  const { default: WebSocketImpl } = await import("ws");
  const pinningLookup = makePrivateIPRejectingLookup();

  class SecureWS extends WebSocketImpl {
    constructor(address: string | URL, protocols?: string | string[], options?: Record<string, unknown>) {
      assertRelayUrlAllowed(typeof address === "string" ? address : address.href);
      super(address, protocols, { ...options, handshakeTimeout: 10_000, lookup: pinningLookup });
    }
  }

  setWsImpl(SecureWS as unknown as typeof WebSocket);
  return new SimplePool();
}
