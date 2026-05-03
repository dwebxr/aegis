// State machine: closed → (FAILURE_THRESHOLD txp failures) → open → (cooldown) → half-open →
// success closes / failure re-opens. Shared by translateOnChain + analyzeOnChain.
// IMPORTANT: validator-level rejections are NOT failures — canister was healthy.

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 60_000;

type State = "closed" | "open" | "half-open";

let state: State = "closed";
let consecutiveFailures = 0;
let openedAt = 0;

// Lazy expiry on entry: a setTimeout would keep the event loop alive and fight fake timers in tests.
function maybeExpireOpen(): void {
  if (state === "open" && Date.now() - openedAt >= OPEN_DURATION_MS) {
    state = "half-open";
  }
}

// When false, caller MUST eventually call recordIcLlmSuccess/Failure with the txp-level outcome.
export function isIcLlmCircuitOpen(): boolean {
  maybeExpireOpen();
  return state === "open";
}

// Transport-level success only. Don't call after validator rejections (canister was fine).
export function recordIcLlmSuccess(): void {
  consecutiveFailures = 0;
  state = "closed";
}

// Transport-level failure (canister reject, call timeout, inter-canister error).
// In half-open, a single failure re-opens immediately and resets the cooldown.
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

// Test seam.
export function _resetIcLlmCircuit(): void {
  state = "closed";
  consecutiveFailures = 0;
  openedAt = 0;
}

export function _icLlmCircuitState(): State {
  maybeExpireOpen();
  return state;
}

export function _icLlmCircuitFailures(): number {
  return consecutiveFailures;
}

export const _IC_LLM_CIRCUIT_CONSTANTS = {
  FAILURE_THRESHOLD,
  OPEN_DURATION_MS,
} as const;
