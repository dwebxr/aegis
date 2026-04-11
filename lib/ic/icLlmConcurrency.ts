/**
 * Shared concurrency gate for all calls to the DFINITY LLM canister
 * routed through the Aegis backend canister.
 *
 * Empirically verified (2026-04-12) that the DFINITY LLM canister
 * `w36hm-eqaaa-aaaal-qr76a-cai` rejects the 3rd concurrent inter-
 * canister call from a single caller (our Aegis backend) with
 * `IC LLM translation failed` after about 1.5 seconds. This limit is
 * NOT documented in the LLM canister README — discovered by binary
 * search of parallel `dfx canister call` requests:
 *
 *   1 parallel: succeeds
 *   2 parallel: both succeed
 *   3 parallel: 2 fast-fail in ~2s, 1 succeeds
 *
 * The Aegis backend canister has TWO methods that call LLM.prompt:
 *
 *   - analyzeOnChain (content scoring, called from contexts/content/scoring.ts)
 *   - translateOnChain (called from lib/translation/engine.ts)
 *
 * Without coordination, the auto-translate effect can fire 2 parallel
 * translateOnChain calls at the same moment a background scheduler
 * fires an analyzeOnChain — total 3 in flight, one is guaranteed to
 * fail. The user perceives this as random translation failures.
 *
 * This module exposes `withIcLlmSlot()`: an async wrapper that
 * acquires one of the 2 available slots before invoking the supplied
 * function and releases it on completion. Callers waiting for a slot
 * are queued FIFO and resume in order. The slot is held for the
 * duration of the inner-canister call (typically 5-10 seconds).
 */

const MAX_CONCURRENT_IC_LLM = 2;

let inFlight = 0;
const waitQueue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT_IC_LLM) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    waitQueue.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

function release(): void {
  inFlight -= 1;
  const next = waitQueue.shift();
  if (next) next();
}

/**
 * Run `fn` while holding one of the IC LLM concurrency slots. Other
 * callers will queue (FIFO) until a slot is available. The slot is
 * always released even if `fn` throws.
 *
 * Usage:
 *   const result = await withIcLlmSlot(() => actor.translateOnChain(prompt));
 */
export async function withIcLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test seam — wipes the in-flight counter and waiter queue. */
export function _resetIcLlmConcurrency(): void {
  inFlight = 0;
  waitQueue.length = 0;
}

/** Test seam — read current in-flight count. */
export function _icLlmInFlight(): number {
  return inFlight;
}

/** Test seam — read current waiter queue length. */
export function _icLlmWaiting(): number {
  return waitQueue.length;
}
