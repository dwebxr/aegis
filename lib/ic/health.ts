import { errMsg } from "@/lib/utils/errors";
import { getCanisterId, getHost } from "@/lib/ic/config";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { withTimeout } from "@/lib/utils/timeout";

// Mirror of canisters/aegis_backend/main.mo CYCLES_THRESHOLD (2T).
// Below this level the canister attempts self-top-up from revenue; operators
// should still be paged so the canister doesn't freeze if revenue is zero.
const CYCLES_THRESHOLD = 2_000_000_000_000n;

// Returns "reachable" | "unreachable" | `error (${status})`. HTTP 400 is reachable: the
// replica is rejecting the empty CBOR body, which proves it's up. String format is load-bearing
// for operator smoke tests.
export async function checkIcCanisterReachable(logPrefix: string): Promise<string> {
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

// Cache: each probe builds an HttpAgent + syncTime + query; uptime monitors hit /api/health every 30s.
let cyclesCache: { at: number; value: CyclesCheck } | null = null;
const CYCLES_CACHE_TTL_MS = 60_000;

export async function checkCanisterCycles(logPrefix: string): Promise<CyclesCheck> {
  const now = Date.now();
  if (cyclesCache && now - cyclesCache.at < CYCLES_CACHE_TTL_MS) {
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
    const actor = await createBackendActorAsync();
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
