import { withTimeout } from "@/lib/utils/timeout";

export const LOCAL_INIT_WAIT_MS = 15_000;
export const LOCAL_QUEUE_WAIT_MS = 15_000;
export const LOCAL_INTERRUPT_GRACE_MS = 5_000;
export const LOCAL_INIT_COOLDOWN_MS = 60_000;
export const LOCAL_RECOVERY_COOLDOWN_MS = 5 * 60_000;
export const LOCAL_SCORE_TIMEOUT_MS = 45_000;
export const LOCAL_TRANSLATE_TIMEOUT_MS = 60_000;

type LocalEngine = "mediapipe" | "webllm";

export class LocalEngineTransientError extends Error {
  constructor(public readonly engine: LocalEngine, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class LocalEngineInitPendingError extends LocalEngineTransientError {
  constructor(engine: LocalEngine) {
    super(engine, "The browser AI model is still loading. Please retry shortly.");
  }
}

export class LocalEngineBusyError extends LocalEngineTransientError {
  constructor(engine: LocalEngine) {
    super(engine, "The browser AI model is busy with another request. Please retry shortly.");
  }
}

export class LocalEngineInitFailedError extends LocalEngineTransientError {
  constructor(engine: LocalEngine, message: string, public readonly cause: unknown) {
    super(engine, message);
  }
}

export class LocalEngineUnavailableError extends Error {
  constructor(public readonly engine: LocalEngine, message: string, public readonly cause: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

/** Retry only known temporary failures; unsupported hardware/models need a change. */
export function createLocalEngineInitError(engine: LocalEngine, message: string, cause: unknown): LocalEngineInitFailedError | LocalEngineUnavailableError {
  const permanent = /WebGPU not available|No GPU adapter found|not supported|unsupported|out of memory|allocation failed|\b40[01345]\b/i.test(message);
  const transient = /Failed to fetch|Load failed|NetworkError|network (?:request failed|error)|fetch failed|ECONNRESET|ECONNREFUSED|timed?\s*out|\btimeout\b|\b(?:408|429|5\d\d)\b|device (?:was )?lost/i.test(message);
  return !permanent && transient
    ? new LocalEngineInitFailedError(engine, message, cause)
    : new LocalEngineUnavailableError(engine, message, cause);
}

export class LocalEngineRecoveringError extends LocalEngineTransientError {
  constructor(engine: LocalEngine) {
    super(engine, "The browser AI engine is recovering after a stalled request. Please retry in a few minutes.");
  }
}

const recoveringUntil = new Map<LocalEngine, number>();

export function clearLocalEngineRecovery(engine: LocalEngine): void {
  recoveringUntil.delete(engine);
}

export function assertLocalEngineReady(engine: LocalEngine): void {
  if (Date.now() < (recoveringUntil.get(engine) ?? 0)) throw new LocalEngineRecoveringError(engine);
  recoveringUntil.delete(engine);
}

export class LocalEngineTimeoutError extends LocalEngineTransientError {
  constructor(engine: LocalEngine) {
    super(engine, "The browser AI request timed out and was interrupted. Please retry shortly.");
  }
}

interface Job {
  priority: "scoring" | "translation";
  start: () => void;
  cancel: () => void;
}

interface EngineQueue {
  active?: Job;
  waiting: Job[];
  destroyed: boolean;
}

// Instance keys keep late settlements from touching a replacement engine's slot.
const queues = new WeakMap<object, EngineQueue>();

/** Interrupt the active request and reject all queued requests before teardown. */
export function resetLocalEngine(instance: object): void {
  let queue = queues.get(instance);
  if (!queue) {
    queue = { waiting: [], destroyed: true };
    queues.set(instance, queue);
  }
  queue.destroyed = true;
  for (const job of queue.waiting.splice(0)) job.cancel();
  queue.active?.cancel();
}

export async function runWithLocalEngine<E extends object, T>({ engine, init, infer, inferTimeoutMs, interrupt, destroy, priority = "translation" }: {
  engine: LocalEngine;
  init: () => Promise<E>;
  infer: (engine: E) => Promise<T>;
  inferTimeoutMs: number;
  interrupt: (engine: E) => void | Promise<void>;
  destroy: (engine: E) => void | Promise<void>;
  priority?: "scoring" | "translation";
}): Promise<T> {
  assertLocalEngineReady(engine);
  const instance = await withTimeout(init(), LOCAL_INIT_WAIT_MS, new LocalEngineInitPendingError(engine));
  assertLocalEngineReady(engine);
  let queue = queues.get(instance);
  if (!queue) {
    queue = { waiting: [], destroyed: false };
    queues.set(instance, queue);
  }
  const state = queue;
  if (state.destroyed) throw new LocalEngineInitPendingError(engine);

  return new Promise<T>((resolve, reject) => {
    let queueTimer: ReturnType<typeof setTimeout>;
    let inferenceTimer: ReturnType<typeof setTimeout>;
    let safetyTimer: ReturnType<typeof setTimeout>;
    let interrupted = false;
    const stop = () => {
      if (interrupted) return;
      interrupted = true;
      // Cancellation can itself fail on a lost GPU; the safety timer still retires it.
      try { void Promise.resolve(interrupt(instance)).catch(() => {}); } catch { /* retire below */ }
    };
    const release = () => {
      clearTimeout(inferenceTimer);
      clearTimeout(safetyTimer);
      if (state.active !== job) return;
      state.active = undefined;
      if (!state.destroyed) state.waiting.shift()?.start();
    };
    const job: Job = {
      priority,
      start: () => {
        clearTimeout(queueTimer);
        state.active = job;
        const pending = Promise.resolve().then(() => {
          if (state.destroyed) throw new LocalEngineInitPendingError(engine);
          return infer(instance);
        });
        void pending.then(
          value => { resolve(value); release(); },
          error => { reject(error); release(); },
        );
        inferenceTimer = setTimeout(() => {
          reject(new LocalEngineTimeoutError(engine));
          // Keep the slot until the original promise settles after interruption.
          // MediaPipe cancellation cannot stop prefilling, so bound that wait too.
          safetyTimer = setTimeout(() => {
            recoveringUntil.set(engine, Date.now() + LOCAL_RECOVERY_COOLDOWN_MS);
            resetLocalEngine(instance);
            try { void Promise.resolve(destroy(instance)).catch(() => {}); } catch { /* already retired */ }
          }, LOCAL_INTERRUPT_GRACE_MS);
          stop();
        }, inferTimeoutMs);
      },
      cancel: () => {
        clearTimeout(queueTimer);
        if (state.active === job) { stop(); release(); }
        reject(new LocalEngineInitPendingError(engine));
      },
    };
    if (state.active) {
      const firstTranslation = priority === "scoring" ? state.waiting.findIndex(waiter => waiter.priority === "translation") : -1;
      if (firstTranslation === -1) state.waiting.push(job);
      else state.waiting.splice(firstTranslation, 0, job);
      queueTimer = setTimeout(() => {
        const index = state.waiting.indexOf(job);
        if (index !== -1) state.waiting.splice(index, 1);
        reject(new LocalEngineBusyError(engine));
      }, LOCAL_QUEUE_WAIT_MS);
    } else {
      job.start();
    }
  });
}
