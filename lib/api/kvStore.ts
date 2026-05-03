/**
 * Lazy Vercel KV (Upstash Redis) singleton.
 *
 * Both rateLimit.ts and dailyBudget.ts need an idempotent "get the KV client
 * if KV_REST_API_URL is configured, otherwise null" accessor. The cache uses
 * `undefined` as the not-yet-checked sentinel so a missing env var still
 * resolves to a stable `null` after first call (no repeated dynamic-import
 * attempts).
 */

type KVStore = Awaited<typeof import("@vercel/kv")>["kv"];
export type { KVStore };

let _kv: KVStore | null | undefined;

export async function getKV(): Promise<KVStore | null> {
  if (_kv !== undefined) return _kv;
  if (!process.env.KV_REST_API_URL) {
    _kv = null;
    return null;
  }
  try {
    const mod = await import("@vercel/kv");
    _kv = mod.kv;
    return _kv;
  } catch (err) {
    console.warn("[kvStore] KV import failed, using in-memory fallback:", err);
    _kv = null;
    return null;
  }
}

/** Reset the lazy singleton — only for tests. */
export function _resetKVCache(): void {
  _kv = undefined;
}
