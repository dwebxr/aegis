// DFINITY LLM canister (w36hm-...-cai) drops the 3rd concurrent inter-canister call from a single
// caller (~1.5s reject, undocumented). Backend has 2 LLM call sites (analyze + translate); without
// this gate, 2 parallel translations + 1 scoring = one drop. FIFO queue across both methods.

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

export async function withIcLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

// Test seam.
export function _resetIcLlmConcurrency(): void {
  inFlight = 0;
  waitQueue.length = 0;
}

export function _icLlmInFlight(): number {
  return inFlight;
}

export function _icLlmWaiting(): number {
  return waitQueue.length;
}
