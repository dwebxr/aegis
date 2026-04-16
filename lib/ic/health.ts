import { errMsg } from "@/lib/utils/errors";
import { getCanisterId, getHost } from "@/lib/ic/config";

/**
 * Probes the IC canister query endpoint to determine reachability.
 *
 * Returns one of:
 *  - `"reachable"` — HTTP 200 or 400 (400 is expected when POSTing an
 *    empty CBOR body — the replica answers but rejects the payload,
 *    which proves it is up and accepting requests).
 *  - `"unreachable"` — the fetch threw (DNS, timeout, connection
 *    refused, etc.). The helper logs under the supplied prefix so
 *    `/api/health` and `/api/d2a/health` stay distinguishable in logs.
 *  - `` `error (${status})` `` — any other status; preserves the
 *    legacy string format that operators and smoke tests rely on.
 */
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

/**
 * Common envelope fields for health-style responses. Both `/api/health`
 * and `/api/d2a/health` report the deploy's short-SHA and region; this
 * helper centralises the env-var access + default so they never drift.
 */
export function getDeployMeta(): { version: string; region: string } {
  return {
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    region: (process.env.VERCEL_REGION || "local").trim(),
  };
}
