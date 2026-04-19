/**
 * Server-side SimplePool loader.
 *
 * `nostr-tools/pool` is an ESM-only module and pulling it into an
 * edge-bundle would inline the whole nostr-tools surface (+ ws).
 * Importing it dynamically keeps it in the server-runtime chunk only.
 *
 * Three call sites were open-coding the same sequence:
 *   1. `await import("nostr-tools/pool")` to get `SimplePool` and
 *      `useWebSocketImplementation`.
 *   2. `await import("ws")` to get the node WebSocket impl.
 *   3. `useWebSocketImplementation(WebSocket)` to wire it up.
 *   4. `new SimplePool()`.
 *
 * This helper captures that invariant. Each caller still owns the
 * pool lifecycle (`pool.close(relays)` / `pool.destroy()` in its own
 * `finally`).
 *
 * NOT for client-side use — the client-bundle nostr-tools entry uses
 * the browser-native WebSocket and the `ws` import would fail.
 */
export async function loadServerPool(): Promise<import("nostr-tools/pool").SimplePool> {
  // Import alias: `useWebSocketImplementation` triggers the
  // react-hooks/rules-of-hooks ESLint rule because its name starts
  // with `use`. It is not a React hook. Rebind to `setWsImpl`.
  const { SimplePool, useWebSocketImplementation: setWsImpl } = await import("nostr-tools/pool");
  const { default: WebSocket } = await import("ws");
  setWsImpl(WebSocket);
  return new SimplePool();
}
