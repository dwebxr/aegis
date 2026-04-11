/**
 * Circuit breaker for the DFINITY LLM canister path.
 *
 * Even with the concurrency gate (`icLlmConcurrency.ts`) capping
 * in-flight calls at 2, the LLM canister intermittently rejects a
 * large fraction of calls with `IC LLM translation failed` in ~1.5s.
 * When ic-llm is in a failing streak every cascade attempt burns ~8s
 * of wall-clock on the auto cascade timeout for zero value, so after
 * `FAILURE_THRESHOLD` consecutive transport failures we OPEN the
 * breaker and the cascade skips ic-llm entirely until the cooldown
 * expires. A cooldown expiry transitions to HALF-OPEN where callers
 * flow through as probes; one probe success closes the breaker, one
 * probe failure re-opens it and restarts the cooldown.
 *
 * Shared by `translateOnChain` (engine.ts) and `analyzeOnChain`
 * (scoring.ts) — both check `isIcLlmCircuitOpen()` before invoking
 * the actor and both report outcomes via `recordIcLlmSuccess` /
 * `recordIcLlmFailure`. Validator-level rejections do NOT count as
 * failures — the canister was healthy, the content was the problem.
 */

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 60_000;

type State = "closed" | "open" | "half-open";

let state: State = "closed";
let consecutiveFailures = 0;
let openedAt = 0;

/**
 * Lazily transition an expired `open` breaker to `half-open`. Called by
 * every query/record entry so we don't need a setTimeout (which would
 * keep event-loop alive in tests and fight fake timers).
 */
function maybeExpireOpen(): void {
  if (state === "open" && Date.now() - openedAt >= OPEN_DURATION_MS) {
    state = "half-open";
  }
}

/**
 * True when callers should SKIP ic-llm entirely. When true, the cascade
 * should record a `skip` entry (with a human-readable cooldown reason)
 * and move to the next backend. When false, callers proceed normally
 * and MUST call `recordIcLlmSuccess` or `recordIcLlmFailure` once the
 * outcome is known.
 */
export function isIcLlmCircuitOpen(): boolean {
  maybeExpireOpen();
  return state === "open";
}

/**
 * Record a successful IC LLM transport-level round trip. Closes the
 * breaker and resets the consecutive failure counter. Validator-level
 * rejections should NOT call this (the canister was healthy, the
 * content just wasn't translatable); only call after a raw response
 * came back without throwing.
 */
export function recordIcLlmSuccess(): void {
  consecutiveFailures = 0;
  state = "closed";
}

/**
 * Record a transport-level failure (canister rejection, call timeout,
 * inter-canister error). Increments the failure counter and may trip
 * the breaker open. In `half-open` state, a single failure immediately
 * re-opens the breaker and resets the cooldown timer.
 */
export function recordIcLlmFailure(): void {
  maybeExpireOpen();
  if (state === "half-open") {
    state = "open";
    openedAt = Date.now();
    consecutiveFailures += 1;
    return;
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    state = "open";
    openedAt = Date.now();
  }
}

/** Test seam — wipes breaker state. */
export function _resetIcLlmCircuit(): void {
  state = "closed";
  consecutiveFailures = 0;
  openedAt = 0;
}

/** Test seam — read the raw state. */
export function _icLlmCircuitState(): State {
  maybeExpireOpen();
  return state;
}

/** Test seam — read consecutive failure count. */
export function _icLlmCircuitFailures(): number {
  return consecutiveFailures;
}

export const _IC_LLM_CIRCUIT_CONSTANTS = {
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS,
} as const;
