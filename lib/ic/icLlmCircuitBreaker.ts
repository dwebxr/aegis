/**
 * Circuit breaker for the DFINITY LLM canister path.
 *
 * Even with the concurrency gate (`icLlmConcurrency.ts`) capping
 * in-flight calls at 2, the LLM canister empirically rejects a large
 * fraction of calls with `IC LLM translation failed` in ~1.5s. The
 * observed per-caller budget is flaky — sometimes 2 parallel calls
 * succeed, sometimes only 1 does. See the production debug log from
 * build `34cb853` (2026-04-12): of 50 attempts only 5 ic-llm calls
 * returned ok, the rest fast-failed or hit the 8s cascade timeout and
 * were rescued by claude-server.
 *
 * When IC LLM is in this failing state, every cascade attempt burns
 * ~8 seconds of wall-clock (the cascade-level timeout) and a round of
 * canister cycles before falling through to claude-server. That is
 * pure overhead — claude-server was always going to answer, the
 * ic-llm hop added latency and waste.
 *
 * The circuit breaker cuts the overhead: after N consecutive failures
 * we mark the breaker OPEN and the cascade skips ic-llm entirely for
 * OPEN_DURATION_MS. A cooldown expiry transitions to HALF_OPEN, where
 * callers are allowed through as probes. A single probe success closes
 * the breaker (normal operation resumes). A probe failure re-opens it
 * and the cooldown starts over.
 *
 * Scope: this breaker is shared across ALL call sites that touch IC
 * LLM — `translateOnChain` in `lib/translation/engine.ts` and
 * `analyzeOnChain` in `contexts/content/scoring.ts`. Both check
 * `isIcLlmCircuitOpen()` before invoking the actor method, and both
 * report outcomes via `recordIcLlmSuccess` / `recordIcLlmFailure`.
 *
 * Not counted as failures: validator-level rejections. If the canister
 * returned a response but the output was unusable (wrong language,
 * meta-commentary that defeated our strippers, etc.), the LLM itself
 * is healthy — the content just didn't translate. Only transport-level
 * errors (canister rejection, timeouts, inter-canister call failures)
 * count toward the failure threshold.
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
 * Human-readable description of the current breaker state, for the
 * translation debug log. Example: `"circuit open — retry in 47s"`.
 */
export function describeIcLlmCircuitState(): string {
  maybeExpireOpen();
  if (state === "closed") return "closed";
  if (state === "half-open") return "half-open (probing)";
  const remainingMs = Math.max(0, OPEN_DURATION_MS - (Date.now() - openedAt));
  const remainingSec = Math.ceil(remainingMs / 1000);
  return `open — retry in ${remainingSec}s`;
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
