import { Actor } from "@dfinity/agent";
import { createAgent, ensureRootKey, getCanisterId } from "./agent";
import { idlFactory } from "./declarations";
import type { _SERVICE } from "./declarations";

/**
 * Actor for the cycles-balance probe only.
 *
 * Kept out of lib/ic/health.ts and imported dynamically so the modules that only
 * need `checkIcCanisterReachable` — /api/d2a/health among them — do not evaluate
 * the whole @dfinity/agent dependency graph on every cold start for a probe that
 * is a plain fetch.
 *
 * Unlike createBackendActorAsync this does NOT call agent.syncTime(). In
 * @dfinity/agent 3.x, HttpAgent.createSync leaves time syncing off, so calling
 * it is opt-in extra work: it issues three parallel read_state calls and
 * verifies three BLS certificates in pure JS. Interactive callers keep it —
 * clock drift breaks their signed update calls — but a one-shot balance query
 * does not depend on an aligned clock, and this probe runs on a schedule.
 */
export async function createHealthActor(): Promise<_SERVICE> {
  const agent = createAgent();
  await ensureRootKey(agent);
  return Actor.createActor<_SERVICE>(idlFactory, {
    agent,
    canisterId: getCanisterId(),
  });
}
