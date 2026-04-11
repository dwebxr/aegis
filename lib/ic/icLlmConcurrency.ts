/**
 * Shared concurrency gate for all calls to the DFINITY LLM canister
 * (`w36hm-eqaaa-aaaal-qr76a-cai`) routed through the Aegis backend.
 *
 * Empirically verified that the LLM canister rejects the 3rd concurrent
 * inter-canister call from a single caller with `IC LLM translation
 * failed` in ~1.5s. Not documented in the LLM canister README —
 * discovered by binary search of parallel dfx calls. The Aegis backend
 * has two methods that call `LLM.prompt` (`analyzeOnChain` for scoring,
 * `translateOnChain` for translation), so without coordination 2
 * parallel translations + 1 background scoring will drop one request.
 *
 * `withIcLlmSlot()` acquires one of `MAX_CONCURRENT_IC_LLM` slots
 * before invoking `fn` and releases on completion (even on throw).
 * Waiting callers queue FIFO.
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
