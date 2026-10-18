/** @jest-environment jsdom */

const mockCreate = jest.fn();
const mockFileset = jest.fn();
let mockImportError: Error | undefined;
let mockModel = "gemma-3-1b";
jest.mock("@mediapipe/tasks-genai", () => {
  if (mockImportError) throw mockImportError;
  return { FilesetResolver: { forGenAiTasks: mockFileset }, LlmInference: { createFromOptions: mockCreate } };
});
jest.mock("@mlc-ai/web-llm", () => {
  if (mockImportError) throw mockImportError;
  return { CreateMLCEngine: mockCreate };
});
jest.mock("@/lib/mediapipe/storage", () => ({ getSelectedMediaPipeModelId: () => mockModel }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function instance() {
  const infer = jest.fn().mockResolvedValue('{"composite":8,"verdict":"quality"}');
  return { close: jest.fn(), unload: jest.fn().mockResolvedValue(undefined),
    cancelProcessing: jest.fn(), interruptGenerate: jest.fn(), generateResponse: infer,
    chat: { completions: { create: async () => ({ choices: [{ message: { content: await infer() } }] }) } },
  };
}

function load(name: "mediapipe" | "webllm") {
  if (name === "mediapipe") {
    const engine = require("@/lib/mediapipe/engine") as typeof import("@/lib/mediapipe/engine");
    return { score: engine.scoreWithMediaPipe, init: engine.getOrCreateInference, destroy: engine.destroyInference, loaded: engine.isMediaPipeLoaded, subscribe: engine.onStatusChange };
  }
  const engine = require("@/lib/webllm/engine") as typeof import("@/lib/webllm/engine");
  return { score: engine.scoreWithWebLLM, init: engine.getOrCreateEngine, destroy: engine.destroyEngine, loaded: engine.isWebLLMLoaded, subscribe: engine.onStatusChange };
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  mockCreate.mockReset();
  mockFileset.mockReset().mockResolvedValue({});
  mockImportError = undefined;
  mockModel = "gemma-3-1b";
  globalThis.fetch = jest.fn().mockResolvedValue({ status: 200 });
  Object.defineProperty(navigator, "gpu", { value: { requestAdapter: jest.fn().mockResolvedValue({}) }, configurable: true });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

describe.each(["mediapipe", "webllm"] as const)("%s lifecycle", name => {
  it.each([new Error("Failed to fetch"), new Error("unknown initialization failure"), new Error("model HTTP 404"), { type: "error" }])("shares the stored transient init failure for 60s without another init: %s", async cause => {
    mockCreate.mockRejectedValueOnce(cause).mockResolvedValue(instance());
    const engine = load(name);
    const { LocalEngineInitFailedError } = require("@/lib/localAI/budget");
    const failure = await engine.init().catch(error => error);
    expect(failure).toBeInstanceOf(LocalEngineInitFailedError);
    expect(failure.cause).toBe(cause);
    await Promise.all(Array.from({ length: 4 }, () => expect(engine.init()).rejects.toBe(failure)));
    await jest.advanceTimersByTimeAsync(59_999);
    await expect(engine.init()).rejects.toBe(failure);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(navigator.gpu!.requestAdapter).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await engine.init();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("off/on clears the init failure cooldown immediately", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(instance());
    const engine = load(name);
    await expect(engine.init()).rejects.toThrow("Failed to fetch");
    await engine.destroy();
    await engine.init();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("interrupts timed-out inference and reuses the slot after cancellation settles", async () => {
    const inf = instance();
    const running = deferred<string>();
    inf.generateResponse.mockReturnValueOnce(running.promise);
    const interrupt = name === "mediapipe" ? inf.cancelProcessing : inf.interruptGenerate;
    interrupt.mockImplementation(() => { running.reject(new Error("cancelled")); });
    mockCreate.mockResolvedValue(inf);
    const engine = load(name);
    const timedOut = expect(engine.score("first", [])).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(45_000);
    await timedOut;
    expect(interrupt).toHaveBeenCalledTimes(1);
    await expect(engine.score("second", [])).resolves.toMatchObject({ composite: 8 });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("safety release blocks re-initialization for five minutes, then allows recovery", async () => {
    const hung = instance();
    const fresh = instance();
    hung.generateResponse.mockReturnValue(new Promise(() => {}));
    mockCreate.mockResolvedValueOnce(hung).mockResolvedValueOnce(fresh);
    const engine = load(name);
    const timedOut = expect(engine.score("first", [])).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(49_999);
    await timedOut;
    expect(engine.loaded()).toBe(true);
    const queued = expect(engine.score("queued", [])).rejects.toThrow("still loading");
    await jest.advanceTimersByTimeAsync(1);
    await queued;
    expect(engine.loaded()).toBe(false);
    expect(name === "mediapipe" ? hung.close : hung.unload).toHaveBeenCalledTimes(1);
    await expect(engine.init()).rejects.toThrow("engine is recovering");
    await expect(engine.score("fresh", [])).rejects.toThrow("engine is recovering");
    await jest.advanceTimersByTimeAsync(299_999);
    await expect(engine.score("fresh", [])).rejects.toThrow("engine is recovering");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(engine.score("fresh", [])).resolves.toMatchObject({ composite: 8 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(hung.generateResponse).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("an off/on teardown clears safety recovery immediately", async () => {
    const hung = instance();
    hung.generateResponse.mockReturnValue(new Promise(() => {}));
    mockCreate.mockResolvedValueOnce(hung).mockResolvedValue(instance());
    const engine = load(name);
    const timedOut = expect(engine.score("hung", [])).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(50_000);
    await timedOut;
    await expect(engine.score("blocked", [])).rejects.toThrow("engine is recovering");
    await engine.destroy();
    await expect(engine.score("fresh", [])).resolves.toMatchObject({ composite: 8 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("changing the enabled setting clears recovery even without an extra teardown", async () => {
    localStorage.clear();
    const setEnabled = name === "mediapipe"
      ? jest.requireActual<typeof import("@/lib/mediapipe/storage")>("@/lib/mediapipe/storage").setMediaPipeEnabled
      : jest.requireActual<typeof import("@/lib/webllm/storage")>("@/lib/webllm/storage").setWebLLMEnabled;
    setEnabled(true);
    const hung = instance();
    hung.generateResponse.mockReturnValue(new Promise(() => {}));
    mockCreate.mockResolvedValueOnce(hung).mockResolvedValue(instance());
    const engine = load(name);
    const timedOut = expect(engine.score("hung", [])).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(50_000);
    await timedOut;
    setEnabled(true); // Rewriting the same config must not clear recovery.
    await expect(engine.init()).rejects.toThrow("engine is recovering");
    setEnabled(false);
    setEnabled(true);
    await expect(engine.score("fresh", [])).resolves.toMatchObject({ composite: 8 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it.each(["no WebGPU", "no adapter", "No GPU adapter found", "Browser not supported: Safari's WebGPU lacks features required by MediaPipe.", "out of memory", "Array buffer allocation failed", "Memory error: model is too large for this device."])("caches permanent init failure: %s", async failure => {
    if (failure === "no WebGPU") Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    else if (failure === "no adapter") (navigator.gpu!.requestAdapter as jest.Mock).mockResolvedValue(null);
    else mockCreate.mockRejectedValue(new Error(failure));
    const engine = load(name);
    const { LocalEngineUnavailableError, LocalEngineTransientError } = require("@/lib/localAI/budget");
    const error = await engine.init().catch(err => err);
    expect(error).toBeInstanceOf(LocalEngineUnavailableError);
    expect(error).not.toBeInstanceOf(LocalEngineTransientError);
    await jest.advanceTimersByTimeAsync(600_000);
    await expect(engine.init()).rejects.toBe(error);
    await expect(engine.score("article", [])).rejects.toBe(error);
    expect(mockCreate).toHaveBeenCalledTimes(failure === "no WebGPU" || failure === "no adapter" ? 0 : 1);
  });

  it("expires a shared init at ten minutes, applies cooldown, and gives retries a fresh deadline", async () => {
    const { LOCAL_INIT_DEADLINE_MS, LOCAL_INIT_COOLDOWN_MS, LocalEngineInitFailedError, LocalEngineInitPendingError } = require("@/lib/localAI/budget");
    expect(LOCAL_INIT_DEADLINE_MS).toBe(10 * 60_000);
    mockCreate.mockReturnValue(new Promise(() => {}));
    const engine = load(name);
    const status = jest.fn();
    engine.subscribe(status);
    const settled = jest.fn();
    const first = engine.init().catch(error => { settled(); return error; });
    const waiting = expect(engine.score("article", [])).rejects.toBeInstanceOf(LocalEngineInitPendingError);
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_DEADLINE_MS - 1);
    await waiting;
    expect(settled).not.toHaveBeenCalled();
    const concurrent = engine.init().catch(error => error);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    const failure = await first;
    expect(failure).toBeInstanceOf(LocalEngineInitFailedError);
    expect(await concurrent).toBe(failure);
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loaded: false, loading: false, error: failure.message }));
    expect(jest.getTimerCount()).toBe(0);
    await expect(engine.score("article", [])).rejects.toBe(failure);
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_COOLDOWN_MS - 1);
    await expect(engine.init()).rejects.toBe(failure);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    const retried = engine.init().catch(error => { settled(); return error; });
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_DEADLINE_MS - 1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(settled).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await retried).toBeInstanceOf(LocalEngineInitFailedError);
    expect(settled).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)("discards a timed-out init that later %ss without affecting its replacement", async settlement => {
    const { LOCAL_INIT_DEADLINE_MS, LOCAL_INIT_COOLDOWN_MS, LocalEngineInitFailedError } = require("@/lib/localAI/budget");
    const old = deferred<ReturnType<typeof instance>>();
    const next = deferred<ReturnType<typeof instance>>();
    mockCreate.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const engine = load(name);
    const expired = expect(engine.init()).rejects.toBeInstanceOf(LocalEngineInitFailedError);
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_DEADLINE_MS);
    await expired;
    const oldProgress = name === "webllm" ? mockCreate.mock.calls[0][1].initProgressCallback : null;
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_COOLDOWN_MS);
    const second = engine.init();
    await jest.advanceTimersByTimeAsync(0);
    const status = jest.fn();
    engine.subscribe(status);
    status.mockClear();
    oldProgress?.({ progress: 1 });
    const stale = instance();
    if (settlement === "resolve") old.resolve(stale);
    else old.reject(new Error("late failure"));
    await jest.advanceTimersByTimeAsync(0);
    expect(name === "mediapipe" ? stale.close : stale.unload).toHaveBeenCalledTimes(settlement === "resolve" ? 1 : 0);
    expect(status).not.toHaveBeenCalled();
    expect(engine.loaded()).toBe(false);
    const concurrent = engine.init();
    const fresh = instance();
    next.resolve(fresh);
    expect(await second).toBe(fresh);
    expect(await concurrent).toBe(fresh);
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_DEADLINE_MS);
    expect(await engine.init()).toBe(fresh);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("includes a stalled adapter in the deadline and ignores its late result", async () => {
    const { LOCAL_INIT_DEADLINE_MS, LocalEngineInitFailedError } = require("@/lib/localAI/budget");
    const adapter = deferred<object>();
    (navigator.gpu!.requestAdapter as jest.Mock).mockReturnValue(adapter.promise);
    const engine = load(name);
    const expired = expect(engine.init()).rejects.toBeInstanceOf(LocalEngineInitFailedError);
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_DEADLINE_MS);
    await expired;
    const status = jest.fn();
    engine.subscribe(status);
    status.mockClear();
    adapter.resolve({});
    await jest.advanceTimersByTimeAsync(0);
    expect(status).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("clears the deadline on destroy without expiring a newer attempt", async () => {
    const { LOCAL_INIT_DEADLINE_MS, LocalEngineInitFailedError } = require("@/lib/localAI/budget");
    mockCreate.mockReturnValue(new Promise(() => {}));
    const engine = load(name);
    void engine.init().catch(() => {});
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_DEADLINE_MS - 1);
    await engine.destroy();
    expect(jest.getTimerCount()).toBe(0);
    const expired = expect(engine.init()).rejects.toBeInstanceOf(LocalEngineInitFailedError);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const status = jest.fn();
    engine.subscribe(status);
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loading: true, error: undefined }));
    await jest.advanceTimersByTimeAsync(LOCAL_INIT_DEADLINE_MS - 1);
    await expired;
    expect(jest.getTimerCount()).toBe(0);
  });

  it("destroy interrupts active inference, clears waiters and permits immediate re-init", async () => {
    const hung = instance();
    hung.generateResponse.mockReturnValue(new Promise(() => {}));
    mockCreate.mockResolvedValueOnce(hung).mockResolvedValueOnce(instance());
    const engine = load(name);
    const cancelled = [engine.score("active", []), engine.score("waiting", [])]
      .map(p => expect(p).rejects.toThrow("still loading"));
    await jest.advanceTimersByTimeAsync(0);
    await engine.destroy();
    await Promise.all(cancelled);
    expect(name === "mediapipe" ? hung.cancelProcessing : hung.interruptGenerate).toHaveBeenCalledTimes(1);
    expect(hung.generateResponse).toHaveBeenCalledTimes(1);
    await expect(engine.score("fresh", [])).resolves.toMatchObject({ composite: 8 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(["adapter", "import", "create"])("clears loading on %s failure and clears the error on retry", async stage => {
    const failure = new Error(`${stage} failed: NetworkError`);
    if (stage === "adapter") (navigator.gpu!.requestAdapter as jest.Mock).mockRejectedValueOnce(failure);
    if (stage === "import") mockImportError = failure;
    mockCreate.mockResolvedValue(instance());
    if (stage === "create") mockCreate.mockRejectedValueOnce(failure);
    const engine = load(name);
    const status = jest.fn();
    engine.subscribe(status);
    await expect(engine.init()).rejects.toMatchObject({ cause: failure });
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, error: expect.stringContaining(`${stage} failed`) }));
    mockImportError = undefined;
    await jest.advanceTimersByTimeAsync(60_000);
    const retry = engine.init();
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loading: true, error: undefined }));
    await retry;
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loaded: true, loading: false, error: undefined }));
  });

  it("closes an init completed after destroy without publishing it", async () => {
    const pending = deferred<ReturnType<typeof instance>>();
    mockCreate.mockReturnValue(pending.promise);
    const engine = load(name);
    const status = jest.fn();
    engine.subscribe(status);
    const first = engine.init();
    const rejected = expect(first).rejects.toThrow("still loading");
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await engine.destroy();
    status.mockClear();
    const stale = instance();
    pending.resolve(stale);
    await rejected;
    expect(name === "mediapipe" ? stale.close : stale.unload).toHaveBeenCalledTimes(1);
    expect(engine.loaded()).toBe(false);
    expect(status).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("off/on preserves the newer init when the old one %ss", async settlement => {
    const old = deferred<ReturnType<typeof instance>>();
    const next = deferred<ReturnType<typeof instance>>();
    mockCreate.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const engine = load(name);
    const first = engine.init();
    const rejected = expect(first).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(0);
    const oldProgress = name === "webllm" ? mockCreate.mock.calls[0][1].initProgressCallback : null;
    await engine.destroy();
    const second = engine.init();
    await jest.advanceTimersByTimeAsync(0);
    const status = jest.fn();
    engine.subscribe(status);
    status.mockClear();
    oldProgress?.({ progress: 0.8 });
    if (settlement === "resolve") old.resolve(instance());
    else old.reject(new Error("old failed"));
    await rejected;
    expect(status).not.toHaveBeenCalled();
    const concurrent = engine.init();
    const fresh = instance();
    next.resolve(fresh);
    expect(await second).toBe(fresh);
    expect(await concurrent).toBe(fresh);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(engine.loaded()).toBe(true);
  });

  it("does not publish an adapter result after destroy", async () => {
    const adapter = deferred<object>();
    (navigator.gpu!.requestAdapter as jest.Mock).mockReturnValue(adapter.promise);
    const engine = load(name);
    const first = engine.init();
    const rejected = expect(first).rejects.toThrow();
    await engine.destroy();
    const status = jest.fn();
    engine.subscribe(status);
    status.mockClear();
    adapter.resolve({});
    await rejected;
    expect(status).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

it("changing MediaPipe models clears the failed model's cooldown", async () => {
  mockCreate.mockRejectedValueOnce(new Error("model too large")).mockResolvedValue(instance());
  const engine = load("mediapipe");
  await expect(engine.init()).rejects.toThrow("model too large");
  mockModel = "gemma-4-e2b";
  await engine.init();
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(mockCreate.mock.calls[1][1].baseOptions.modelAssetPath).toContain("gemma-4-E2B");
});

it.each([false, true])("discards MediaPipe init after model change (new request: %s)", async newRequest => {
  const old = deferred<ReturnType<typeof instance>>();
  const next = deferred<ReturnType<typeof instance>>();
  mockCreate.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const engine = load("mediapipe");
  const first = engine.init();
  const rejected = expect(first).rejects.toThrow();
  await jest.advanceTimersByTimeAsync(0);
  mockModel = "gemma-4-e2b";
  const second = newRequest ? engine.init() : null;
  await jest.advanceTimersByTimeAsync(0);
  const stale = instance();
  old.resolve(stale);
  await rejected;
  expect(stale.close).toHaveBeenCalledTimes(1);
  expect(engine.loaded()).toBe(false);
  const fresh = instance();
  next.resolve(fresh);
  expect(await (second ?? engine.init())).toBe(fresh);
  expect(mockCreate.mock.calls[1][1].baseOptions.modelAssetPath).toContain("gemma-4-E2B");
});

it.each(["fileset", "create"])("reports version skew after a %s failure only when HEAD is 404", async stage => {
  const failure = new Error("wasm failed");
  if (stage === "fileset") mockFileset.mockRejectedValue(failure);
  else mockCreate.mockRejectedValue(failure);
  globalThis.fetch = jest.fn().mockResolvedValue({ status: 404 });
  const engine = load("mediapipe");
  const status = jest.fn();
  engine.subscribe(status);
  await expect(engine.init()).rejects.toThrow("AI engine files are missing or were updated — reload the page. (Developers: start with `npm run dev`, which copies them.)");
  expect(globalThis.fetch).toHaveBeenCalledWith("/vendor/mediapipe/tasks-genai@0.10.29/wasm/genai_wasm_internal.js", { method: "HEAD" });
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, error: expect.stringContaining("reload the page") }));
  (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 200 });
  await engine.destroy();
  await expect(engine.init()).rejects.toMatchObject({ cause: failure });
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, error: "wasm failed" }));
});

it("bounds the skew probe and clears loading even while that probe is stuck", async () => {
  mockFileset.mockRejectedValue(new Error("fileset failed"));
  globalThis.fetch = jest.fn(() => new Promise(() => {}));
  const engine = load("mediapipe");
  const status = jest.fn();
  engine.subscribe(status);
  const failed = expect(engine.init()).rejects.toThrow("fileset failed");
  await jest.advanceTimersByTimeAsync(0);
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, error: "fileset failed" }));
  await jest.advanceTimersByTimeAsync(3_000);
  await failed;
});

it("changing MediaPipe models clears safety recovery and emits the newly selected model", async () => {
  const hung = instance();
  hung.generateResponse.mockReturnValue(new Promise(() => {}));
  mockCreate.mockResolvedValueOnce(hung).mockResolvedValue(instance());
  const engine = load("mediapipe");
  const timedOut = expect(engine.score("hung", [])).rejects.toThrow("timed out");
  await jest.advanceTimersByTimeAsync(50_000);
  await timedOut;
  await expect(engine.init()).rejects.toThrow("engine is recovering");
  mockModel = "gemma-4-e2b";
  const status = jest.fn();
  engine.subscribe(status);
  // FeedSection writes the model selection and tears down even an unloaded model.
  await engine.destroy();
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: mockModel, loaded: false, loading: false }));
  await expect(engine.score("fresh", [])).resolves.toMatchObject({ composite: 8 });
  expect(mockCreate).toHaveBeenCalledTimes(2);
});

it("writing a different MediaPipe model clears safety recovery", async () => {
  localStorage.clear();
  const { setMediaPipeConfig } = jest.requireActual<typeof import("@/lib/mediapipe/storage")>("@/lib/mediapipe/storage");
  setMediaPipeConfig({ enabled: true, modelId: "gemma-3-1b" });
  const hung = instance();
  hung.generateResponse.mockReturnValue(new Promise(() => {}));
  mockCreate.mockResolvedValueOnce(hung).mockResolvedValue(instance());
  const engine = load("mediapipe");
  const timedOut = expect(engine.score("hung", [])).rejects.toThrow("timed out");
  await jest.advanceTimersByTimeAsync(50_000);
  await timedOut;
  setMediaPipeConfig({ enabled: true, modelId: "gemma-3-1b" });
  await expect(engine.init()).rejects.toThrow("engine is recovering");
  mockModel = "gemma-4-e2b";
  setMediaPipeConfig({ enabled: true, modelId: "gemma-4-e2b" });
  await expect(engine.score("fresh", [])).resolves.toMatchObject({ composite: 8 });
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
