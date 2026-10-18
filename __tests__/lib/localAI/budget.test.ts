import {
  LOCAL_INIT_WAIT_MS,
  LOCAL_SCORE_TIMEOUT_MS,
  LOCAL_TRANSLATE_TIMEOUT_MS,
  LocalEngineInitPendingError,
  LocalEngineBusyError,
  LocalEngineTimeoutError,
  LocalEngineTransientError,
  runWithLocalEngine,
} from "@/lib/localAI/budget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe.each(["mediapipe", "webllm"] as const)("%s budgets", engine => {
  it("stops waiting for init at 15s without starting inference, then reuses a late init", async () => {
    const loading = deferred<object>();
    const infer = jest.fn().mockResolvedValue("result");
    const options = { engine, init: () => loading.promise, infer, inferTimeoutMs: LOCAL_SCORE_TIMEOUT_MS };
    const first = runWithLocalEngine(options);
    const rejected = expect(first).rejects.toBeInstanceOf(LocalEngineInitPendingError);
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_WAIT_MS - 1);
    expect(infer).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    const loaded = {};
    loading.resolve(loaded);
    await jest.advanceTimersByTimeAsync(0);
    expect(infer).not.toHaveBeenCalled();
    await expect(runWithLocalEngine(options)).resolves.toBe("result");
    expect(infer).toHaveBeenCalledTimes(1);
    expect(infer).toHaveBeenCalledWith(loaded);
  });

  it.each([LOCAL_SCORE_TIMEOUT_MS, LOCAL_TRANSLATE_TIMEOUT_MS])("gives inference its full %i ms after 14s of init", async inferTimeoutMs => {
    const loading = deferred<object>();
    const running = deferred<string>();
    const infer = jest.fn(() => running.promise);
    const settled = jest.fn();
    const pending = runWithLocalEngine({ engine, init: () => loading.promise, infer, inferTimeoutMs });
    void pending.then(settled, settled);
    const rejected = expect(pending).rejects.toBeInstanceOf(LocalEngineTimeoutError);
    await jest.advanceTimersByTimeAsync(14_000);
    loading.resolve({});
    await jest.advanceTimersByTimeAsync(0);
    expect(infer).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(inferTimeoutMs - 1);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    running.resolve("late");
    await jest.advanceTimersByTimeAsync(0);
  });

  it.each(["resolve", "reject"] as const)("keeps the guard after timeout until the original inference %ss", async settlement => {
    const running = deferred<string>();
    const infer = jest.fn().mockReturnValueOnce(running.promise).mockResolvedValue("next");
    const options = { engine, init: async () => ({}), infer, inferTimeoutMs: LOCAL_SCORE_TIMEOUT_MS };
    const first = runWithLocalEngine(options);
    const timedOut = expect(first).rejects.toBeInstanceOf(LocalEngineTimeoutError);
    await jest.advanceTimersByTimeAsync(0);
    await expect(runWithLocalEngine(options)).rejects.toBeInstanceOf(LocalEngineBusyError);
    await jest.advanceTimersByTimeAsync(LOCAL_SCORE_TIMEOUT_MS);
    await timedOut;
    await expect(runWithLocalEngine(options)).rejects.toBeInstanceOf(LocalEngineBusyError);
    expect(infer).toHaveBeenCalledTimes(1);
    if (settlement === "resolve") running.resolve("late");
    else running.reject(new Error("late failure"));
    await jest.advanceTimersByTimeAsync(0);
    await expect(runWithLocalEngine(options)).resolves.toBe("next");
  });

  it("preserves original failures and releases the guard on synchronous inference errors", async () => {
    const failure = new Error("model failed");
    const options = { engine, init: async () => ({}), infer: jest.fn((): Promise<string> => { throw failure; }), inferTimeoutMs: 1 };
    await expect(runWithLocalEngine(options)).rejects.toBe(failure);
    options.infer.mockResolvedValue("retry");
    await expect(runWithLocalEngine(options)).resolves.toBe("retry");
    await expect(runWithLocalEngine({ ...options, init: () => Promise.reject(failure) })).rejects.toBe(failure);
  });
});

it("has independent guards per engine and a common transient error type", async () => {
  const running = deferred<string>();
  const first = runWithLocalEngine({ engine: "mediapipe", init: async () => ({}), infer: () => running.promise, inferTimeoutMs: 100 });
  await expect(runWithLocalEngine({ engine: "webllm", init: async () => ({}), infer: async () => "free", inferTimeoutMs: 100 })).resolves.toBe("free");
  running.resolve("done");
  await first;
  for (const ErrorType of [LocalEngineInitPendingError, LocalEngineBusyError, LocalEngineTimeoutError]) {
    expect(new ErrorType("mediapipe")).toBeInstanceOf(LocalEngineTransientError);
  }
});
