import {
  LOCAL_INIT_WAIT_MS,
  clearLocalEngineRecovery,
  createLocalEngineInitError,
  LocalEngineInitFailedError,
  LocalEngineUnavailableError,
  LocalEngineRecoveringError,
  LOCAL_QUEUE_WAIT_MS,
  LOCAL_INTERRUPT_GRACE_MS,
  LOCAL_SCORE_TIMEOUT_MS,
  LOCAL_TRANSLATE_TIMEOUT_MS,
  LocalEngineInitPendingError,
  LocalEngineBusyError,
  LocalEngineTimeoutError,
  LocalEngineTransientError,
  resetLocalEngine,
  runWithLocalEngine,
} from "@/lib/localAI/budget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => { jest.useFakeTimers(); clearLocalEngineRecovery("mediapipe"); clearLocalEngineRecovery("webllm"); });
afterEach(() => { jest.useRealTimers(); });

describe.each(["mediapipe", "webllm"] as const)("%s budgets", engine => {
  const options = () => {
    const instance = {};
    return { engine, init: async () => instance, infer: jest.fn().mockResolvedValue("result"),
      interrupt: jest.fn(), destroy: jest.fn(), inferTimeoutMs: LOCAL_SCORE_TIMEOUT_MS };
  };

  it("stops waiting for init at 15s without starting inference, then reuses a late init", async () => {
    const loading = deferred<object>();
    const opts = { ...options(), init: () => loading.promise };
    const rejected = expect(runWithLocalEngine(opts)).rejects.toBeInstanceOf(LocalEngineInitPendingError);
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_WAIT_MS - 1);
    expect(opts.infer).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    loading.resolve({});
    await jest.advanceTimersByTimeAsync(0);
    expect(opts.infer).not.toHaveBeenCalled();
    await expect(runWithLocalEngine(opts)).resolves.toBe("result");
    expect(opts.infer).toHaveBeenCalledTimes(1);
  });

  it.each([LOCAL_SCORE_TIMEOUT_MS, LOCAL_TRANSLATE_TIMEOUT_MS])("gives inference its full %i ms after 14s of init", async inferTimeoutMs => {
    const loading = deferred<object>();
    const running = deferred<string>();
    const opts = { ...options(), init: () => loading.promise, infer: jest.fn(() => running.promise), inferTimeoutMs };
    const settled = jest.fn();
    const pending = runWithLocalEngine(opts);
    void pending.then(settled, settled);
    const rejected = expect(pending).rejects.toBeInstanceOf(LocalEngineTimeoutError);
    await jest.advanceTimersByTimeAsync(14_000);
    loading.resolve({});
    await jest.advanceTimersByTimeAsync(0);
    expect(opts.infer).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(inferTimeoutMs - 1);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect(opts.interrupt).toHaveBeenCalledTimes(1);
    running.resolve("late");
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("serves four concurrent requests sequentially in FIFO order in one wave", async () => {
    const opts = options();
    const order: number[] = [];
    const jobs = Array.from({ length: 4 }, (_, i) => runWithLocalEngine({ ...opts,
      infer: () => { order.push(i); return new Promise(resolve => setTimeout(() => resolve(i), 1_000)); },
    }));
    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual([0]);
    for (let i = 1; i <= 4; i++) {
      await jest.advanceTimersByTimeAsync(1_000);
      expect(order).toEqual(Array.from({ length: Math.min(i + 1, 4) }, (_, n) => n));
    }
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("serves scoring ahead of three queued translations and preserves FIFO within each priority", async () => {
    const opts = options();
    const order: string[] = [];
    const run = (id: string, priority: "scoring" | "translation") => runWithLocalEngine({ ...opts, priority,
      infer: () => { order.push(id); return new Promise(resolve => setTimeout(() => resolve(id), 1_000)); },
    });
    const jobs = [run("active", "translation")];
    await jest.advanceTimersByTimeAsync(0);
    jobs.push(run("t1", "translation"), run("t2", "translation"), run("t3", "translation"));
    jobs.push(run("s1", "scoring"), run("s2", "scoring"));
    await jest.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual(["active", "s1"]);
    await jest.advanceTimersByTimeAsync(5_000);
    await Promise.all(jobs);
    expect(order).toEqual(["active", "s1", "s2", "t1", "t2", "t3"]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("removes waiters at 15s without running or leaking them", async () => {
    const opts = options();
    const running = deferred<string>();
    opts.infer.mockReturnValueOnce(running.promise);
    const first = runWithLocalEngine(opts);
    const waiters = [1, 2, 3].map(() => expect(runWithLocalEngine(opts)).rejects.toBeInstanceOf(LocalEngineBusyError));
    await jest.advanceTimersByTimeAsync(LOCAL_QUEUE_WAIT_MS - 1);
    expect(opts.infer).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(waiters);
    running.resolve("first");
    await first;
    await expect(runWithLocalEngine(opts)).resolves.toBe("result");
    expect(opts.infer).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)("releases the slot only when interrupted inference %ss", async settlement => {
    const opts = { ...options(), inferTimeoutMs: 100 };
    const running = deferred<string>();
    opts.infer.mockReturnValueOnce(running.promise);
    const timedOut = expect(runWithLocalEngine(opts)).rejects.toBeInstanceOf(LocalEngineTimeoutError);
    const next = runWithLocalEngine(opts);
    await jest.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(opts.interrupt).toHaveBeenCalledTimes(1);
    expect(opts.infer).toHaveBeenCalledTimes(1);
    if (settlement === "resolve") running.resolve("late");
    else running.reject(new Error("cancelled"));
    await expect(next).resolves.toBe("result");
    expect(opts.destroy).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(["no-op", "throw", "reject"])("retires a hung instance after the 5s grace even if interrupt is %s", async behavior => {
    const opts = { ...options(), inferTimeoutMs: 100 };
    opts.infer.mockReturnValueOnce(new Promise(() => {}));
    if (behavior === "throw") opts.interrupt.mockImplementation(() => { throw new Error("lost GPU"); });
    if (behavior === "reject") opts.interrupt.mockRejectedValue(new Error("lost GPU"));
    const timedOut = expect(runWithLocalEngine(opts)).rejects.toBeInstanceOf(LocalEngineTimeoutError);
    const queued = expect(runWithLocalEngine(opts)).rejects.toBeInstanceOf(LocalEngineInitPendingError);
    await jest.advanceTimersByTimeAsync(100 + LOCAL_INTERRUPT_GRACE_MS - 1);
    await timedOut;
    expect(opts.destroy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await queued;
    expect(opts.destroy).toHaveBeenCalledWith(await opts.init());
    await expect(runWithLocalEngine(opts)).rejects.toBeInstanceOf(LocalEngineRecoveringError);
    expect(opts.infer).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("reset cancels active and queued jobs; a late settlement cannot release a new instance", async () => {
    const old = options();
    const running = deferred<string>();
    old.infer.mockReturnValue(running.promise);
    const cancelled = [runWithLocalEngine(old), runWithLocalEngine(old)].map(p => expect(p).rejects.toBeInstanceOf(LocalEngineInitPendingError));
    await jest.advanceTimersByTimeAsync(0);
    resetLocalEngine(await old.init());
    await Promise.all(cancelled);
    expect(old.interrupt).toHaveBeenCalledTimes(1);
    expect(old.infer).toHaveBeenCalledTimes(1);
    const fresh = options();
    const newRunning = deferred<string>();
    fresh.infer.mockReturnValueOnce(newRunning.promise);
    const first = runWithLocalEngine(fresh);
    const next = runWithLocalEngine(fresh);
    running.resolve("stale");
    await jest.advanceTimersByTimeAsync(0);
    expect(fresh.infer).toHaveBeenCalledTimes(1);
    newRunning.resolve("new");
    await first;
    await next;
    expect(jest.getTimerCount()).toBe(0);
  });

  it("preserves original failures and releases on synchronous inference errors", async () => {
    const failure = new Error("model failed");
    const opts = options();
    opts.infer.mockImplementationOnce(() => { throw failure; });
    await expect(runWithLocalEngine(opts)).rejects.toBe(failure);
    await expect(runWithLocalEngine(opts)).resolves.toBe("result");
    await expect(runWithLocalEngine({ ...opts, init: () => Promise.reject(failure) })).rejects.toBe(failure);
  });
});

it("has independent engine slots and a common transient error type", async () => {
  const running = deferred<string>();
  const lifecycle = { interrupt: jest.fn(), destroy: jest.fn() };
  const first = runWithLocalEngine({ ...lifecycle, engine: "mediapipe", init: async () => ({}), infer: () => running.promise, inferTimeoutMs: 100 });
  await expect(runWithLocalEngine({ ...lifecycle, engine: "webllm", init: async () => ({}), infer: async () => "free", inferTimeoutMs: 100 })).resolves.toBe("free");
  running.resolve("done");
  await first;
  for (const ErrorType of [LocalEngineInitPendingError, LocalEngineBusyError, LocalEngineTimeoutError]) {
    expect(new ErrorType("mediapipe")).toBeInstanceOf(LocalEngineTransientError);
  }
});

describe("initialization failure classification", () => {
  it.each(["Failed to fetch", "Load failed", "NetworkError", "network request failed", "fetch failed", "ECONNRESET", "request timed out", "HTTP 408", "HTTP 429", "HTTP 503", "GPU device lost"])("keeps a temporary failure retryable: %s", message => {
    const cause = new Error(message);
    const error = createLocalEngineInitError("mediapipe", message, cause);
    expect(error).toBeInstanceOf(LocalEngineInitFailedError);
    expect(error.cause).toBe(cause);
  });

  it.each(["WebGPU not available", "No GPU adapter found", "unsupported feature", "out of memory", "Array buffer allocation failed", "fetch failed: HTTP 404", "unknown error"])("makes a permanent or unrecognized failure terminal: %s", message => {
    expect(createLocalEngineInitError("webllm", message, null)).toBeInstanceOf(LocalEngineUnavailableError);
  });
});
