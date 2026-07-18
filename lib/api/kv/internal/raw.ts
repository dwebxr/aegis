type KVStore = Awaited<typeof import("@vercel/kv")>["kv"];

export async function getRawKV(): Promise<KVStore | null> {
  if (!process.env.KV_REST_API_URL) return null;

  try {
    const mod = await import("@vercel/kv");
    return mod.kv;
  } catch (err) {
    console.warn("[kvStore] KV import failed, using in-memory fallback:", err);
    return null;
  }
}
