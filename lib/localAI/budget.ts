import { withTimeout } from "@/lib/utils/timeout";

export const LOCAL_INIT_WAIT_MS = 15_000;
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

export class LocalEngineTimeoutError extends LocalEngineTransientError {
  constructor(engine: LocalEngine) {
    super(engine, "The browser AI request timed out. The model may still be busy; please retry shortly.");
  }
}

const busyEngines = new Set<LocalEngine>();

export async function runWithLocalEngine<E, T>({ engine, init, infer, inferTimeoutMs }: {
  engine: LocalEngine;
  init: () => Promise<E>;
  infer: (engine: E) => Promise<T>;
  inferTimeoutMs: number;
}): Promise<T> {
  const instance = await withTimeout(init(), LOCAL_INIT_WAIT_MS, new LocalEngineInitPendingError(engine));
  if (busyEngines.has(engine)) throw new LocalEngineBusyError(engine);
  busyEngines.add(engine);

  // A timeout does not cancel GPU work. Keep the slot until that work settles.
  const pending = Promise.resolve().then(() => infer(instance));
  const release = () => { busyEngines.delete(engine); };
  void pending.then(release, release);
  return withTimeout(pending, inferTimeoutMs, new LocalEngineTimeoutError(engine));
}
