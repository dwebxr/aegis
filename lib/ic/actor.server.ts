import "server-only";
import type { _SERVICE } from "./declarations";
import { createBackendActorAsync } from "./actor";
import { getServerIdentity } from "./serverIdentity";

/** Cached server-controller actor — one per cold start. The Ed25519 identity is
 *  expensive to derive (Curve25519 scalar mult) so reuse it across requests
 *  on the same Vercel function instance. */
let cached: Promise<_SERVICE> | null = null;

export async function createServerControllerActorAsync(): Promise<_SERVICE> {
  if (cached) return cached;
  cached = createBackendActorAsync(getServerIdentity());
  // If the first build fails (bad env var, canister unreachable), don't cache
  // the failure — the operator may fix the env and we want the next request
  // to retry rather than serve a stale rejected promise.
  cached.catch(() => { cached = null; });
  return cached;
}
