// Server-only: dynamic import keeps nostr-tools/pool + ws out of edge bundles.
// Caller owns lifecycle (pool.close/destroy in its own finally). Client uses native WebSocket.
export async function loadServerPool(): Promise<import("nostr-tools/pool").SimplePool> {
  // Rebind useWebSocketImplementation → setWsImpl: the `use` prefix trips react-hooks/rules-of-hooks.
  const { SimplePool, useWebSocketImplementation: setWsImpl } = await import("nostr-tools/pool");
  const { default: WebSocket } = await import("ws");
  setWsImpl(WebSocket);
  return new SimplePool();
}
