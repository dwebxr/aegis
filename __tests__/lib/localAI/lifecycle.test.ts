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
  return { close: jest.fn(), unload: jest.fn().mockResolvedValue(undefined) };
}

function load(name: "mediapipe" | "webllm") {
  if (name === "mediapipe") {
    const engine = require("@/lib/mediapipe/engine") as typeof import("@/lib/mediapipe/engine");
    return { init: engine.getOrCreateInference, destroy: engine.destroyInference, loaded: engine.isMediaPipeLoaded, subscribe: engine.onStatusChange };
  }
  const engine = require("@/lib/webllm/engine") as typeof import("@/lib/webllm/engine");
  return { init: engine.getOrCreateEngine, destroy: engine.destroyEngine, loaded: engine.isWebLLMLoaded, subscribe: engine.onStatusChange };
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
  it.each(["adapter", "import", "create"])("clears loading on %s failure and clears the error on retry", async stage => {
    const failure = new Error(`${stage} failed`);
    if (stage === "adapter") (navigator.gpu!.requestAdapter as jest.Mock).mockRejectedValueOnce(failure);
    if (stage === "import") mockImportError = failure;
    mockCreate.mockResolvedValue(instance());
    if (stage === "create") mockCreate.mockRejectedValueOnce(failure);
    const engine = load(name);
    const status = jest.fn();
    engine.subscribe(status);
    await expect(engine.init()).rejects.toBe(failure);
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, error: expect.stringContaining(`${stage} failed`) }));
    mockImportError = undefined;
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
  await expect(engine.init()).rejects.toThrow("AI engine files were updated — reload the page to use the new version.");
  expect(globalThis.fetch).toHaveBeenCalledWith("/vendor/mediapipe/tasks-genai@0.10.29/wasm/genai_wasm_internal.js", { method: "HEAD" });
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, error: expect.stringContaining("reload the page") }));
  (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 200 });
  await expect(engine.init()).rejects.toBe(failure);
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
