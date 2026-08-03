import { errMsg } from "@/lib/utils/errors";
import { getCanisterId, getHost } from "@/lib/ic/config";
import { withTimeout } from "@/lib/utils/timeout";

// Mirror of canisters/aegis_backend/main.mo CYCLES_THRESHOLD (2T).
// Below this level the canister attempts self-top-up from revenue; operators
// should still be paged so the canister doesn't freeze if revenue is zero.
const CYCLES_THRESHOLD = 2_000_000_000_000n;

// Returns "reachable" | "unreachable" | `error (${status})`. HTTP 400 is reachable: the
// replica is rejecting the empty CBOR body, which proves it's up. String format is load-bearing
// for operator smoke tests.
/**
 * Reachability is polled by two routes and is the same answer for every caller,
 * so it is cached per instance. 30 seconds matches the CDN window /api/health
 * hands the edge, keeping the worst case a caller can see bounded and small:
 * ~30s on /api/d2a/health, ~60s on /api/health where both layers can stack.
 */
let reachableCache: { at: number; value: string } | null = null;
const REACHABLE_CACHE_TTL_MS = 30_000;

export function _resetReachableCache(): void {
  reachableCache = null;
}

export async function checkIcCanisterReachable(logPrefix: string): Promise<string> {
  const now = Date.now();
  if (reachableCache && now - reachableCache.at < REACHABLE_CACHE_TTL_MS) {
    return reachableCache.value;
  }
  const value = await probeReachable(logPrefix);
  reachableCache = { at: now, value };
  return value;
}

async function probeReachable(logPrefix: string): Promise<string> {
  const icHost = getHost();
  const canisterId = getCanisterId();
  try {
    const icRes = await fetch(`${icHost}/api/v2/canister/${canisterId}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/cbor" },
      body: new Uint8Array(0),
      signal: AbortSignal.timeout(5000),
    });
    return icRes.status === 400 || icRes.ok ? "reachable" : `error (${icRes.status})`;
  } catch (err) {
    console.warn(`${logPrefix} IC canister check failed:`, errMsg(err));
    return "unreachable";
  }
}

type CyclesCheck =
  | { status: "ok"; balance: string }
  | { status: "low"; balance: string }
  | { status: "error"; error: string };

// Each probe builds an HttpAgent and runs a signed query whose certificate is
// verified in pure JS — the most expensive thing this route does. Cached per
// instance, with a TTL chosen per outcome rather than one blanket value:
// caching a bad state as long as a good one would keep alerting on a problem
// that has already been fixed.
let cyclesCache: { at: number; value: CyclesCheck } | null = null;
const CYCLES_CACHE_TTL_MS: Record<CyclesCheck["status"], number> = {
  // Slow-moving operational number (≈3.2T against a 2T floor) that the canister
  // tops up from revenue. A 15-minute-old "ok" is still true; the trade is that
  // a fall below the threshold surfaces up to 15 minutes late.
  ok: 15 * 60 * 1000,
  // The page-worthy state. Re-probe often so the balance shown is current and a
  // top-up clears the alert promptly.
  low: 60_000,
  // A failed probe describes the probe, not the canister. Kept only long enough
  // to stop an outage turning every health request into a full round trip.
  error: 30_000,
};

export async function checkCanisterCycles(logPrefix: string): Promise<CyclesCheck> {
  const now = Date.now();
  if (cyclesCache && now - cyclesCache.at < CYCLES_CACHE_TTL_MS[cyclesCache.value.status]) {
    return cyclesCache.value;
  }
  const value = await probeCycles(logPrefix);
  cyclesCache = { at: now, value };
  return value;
}

export function _resetCyclesCache(): void {
  cyclesCache = null;
}

async function probeCycles(logPrefix: string): Promise<CyclesCheck> {
  try {
    // Dynamic: keeps @dfinity/agent out of the module graph that /api/d2a/health
    // evaluates at cold boot — that route only ever calls the fetch-based
    // reachability probe above.
    const { createHealthActor } = await import("./healthActor");
    const actor = await createHealthActor();
    const balance = await withTimeout(actor.getCyclesBalance(), 5000, "getCyclesBalance timeout");
    const status = balance < CYCLES_THRESHOLD ? "low" : "ok";
    return { status, balance: balance.toString() };
  } catch (err) {
    const error = errMsg(err);
    console.warn(`${logPrefix} cycles balance check failed:`, error);
    return { status: "error", error };
  }
}

export function getDeployMeta(): { version: string; region: string } {
  return {
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    region: (process.env.VERCEL_REGION || "local").trim(),
  };
}
