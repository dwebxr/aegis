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
  it("shares the stored transient init failure for 60s without another init", async () => {
    mockCreate.mockRejectedValueOnce(new Error("download failed")).mockResolvedValue(instance());
    const engine = load(name);
    const { LocalEngineTransientError } = require("@/lib/localAI/budget");
    const failure = await engine.init().catch(error => error);
    expect(failure).toBeInstanceOf(LocalEngineTransientError);
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
    mockCreate.mockRejectedValueOnce(new Error("download failed")).mockResolvedValue(instance());
    const engine = load(name);
    await expect(engine.init()).rejects.toThrow("download failed");
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

  it("safety release destroys a hung instance and the next request re-initializes", async () => {
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
    await expect(engine.score("fresh", [])).resolves.toMatchObject({ composite: 8 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(hung.generateResponse).toHaveBeenCalledTimes(1);
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
    const failure = new Error(`${stage} failed`);
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
  await jest.advanceTimersByTimeAsync(60_000);
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
