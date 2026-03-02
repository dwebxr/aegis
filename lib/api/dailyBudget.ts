/**
 * Per-day budget for expensive API calls (e.g. Anthropic).
 *
 * When Vercel KV (Upstash Redis) is configured via KV_REST_API_URL,
 * the counter is shared across all serverless instances using atomic
 * Redis INCR with date-based key partitioning and 24h TTL.
 *
 * Without KV, falls back to per-instance in-memory tracking (same as
 * before — resets on cold start, each instance gets its own budget).
 */

const _parsed = parseInt((process.env.ANTHROPIC_DAILY_BUDGET || "500").trim(), 10);
const DAILY_BUDGET = Number.isNaN(_parsed) ? 500 : _parsed;

// In-memory fallback (per-instance)
let memCalls = 0;
let memResetAt = Date.now() + 86_400_000;

// Lazy-loaded KV singleton: undefined = not checked, null = unavailable
type KVStore = Awaited<typeof import("@vercel/kv")>["kv"];
let _kv: KVStore | null | undefined;

async function getKV(): Promise<KVStore | null> {
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
    console.warn("[dailyBudget] KV import failed, using in-memory fallback:", err);
    _kv = null;
    return null;
  }
}

function dailyKey(): string {
  return `aegis:api-calls:${new Date().toISOString().slice(0, 10)}`;
}

export async function withinDailyBudget(): Promise<boolean> {
  const store = await getKV();
  if (store) {
    const count = (await store.get<number>(dailyKey())) ?? 0;
    return count < DAILY_BUDGET;
  }
  const now = Date.now();
  if (now >= memResetAt) {
    memCalls = 0;
    memResetAt = now + 86_400_000;
  }
  return memCalls < DAILY_BUDGET;
}

export async function recordApiCall(): Promise<void> {
  const store = await getKV();
  if (store) {
    const key = dailyKey();
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, 86_400);
    const threshold = Math.floor(DAILY_BUDGET * 0.1);
    if (threshold > 0 && count === DAILY_BUDGET - threshold) {
      console.warn(`[dailyBudget] 90% consumed: ${count}/${DAILY_BUDGET} calls used`);
    }
    return;
  }
  memCalls++;
  const threshold = Math.floor(DAILY_BUDGET * 0.1);
  if (threshold > 0 && memCalls === DAILY_BUDGET - threshold) {
    console.warn(`[dailyBudget] 90% consumed: ${memCalls}/${DAILY_BUDGET} calls used`);
  }
}

export async function _resetDailyBudget(): Promise<void> {
  const store = await getKV();
  if (store) await store.del(dailyKey());
  memCalls = 0;
  memResetAt = Date.now() + 86_400_000;
  _kv = undefined; // Reset lazy cache for test isolation
}
