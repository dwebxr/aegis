/** @jest-environment jsdom */

import { TextEncoder } from "node:util";
Object.assign(globalThis, { TextEncoder });
if (!AbortSignal.timeout) AbortSignal.timeout = () => new AbortController().signal;

const mockCreate = jest.fn();
const mockGenerate = jest.fn();
let mockBrowser: "mediapipe" | "webllm" = "mediapipe";
const makeInstance = () => ({
  generateResponse: mockGenerate,
  cancelProcessing: jest.fn(),
  interruptGenerate: jest.fn(),
  close: jest.fn(),
  chat: { completions: { create: async () => ({ choices: [{ message: { content: await mockGenerate() } }] }) } },
  unload: jest.fn().mockResolvedValue(undefined),
});
let mockInstance = makeInstance();
jest.mock("@mediapipe/tasks-genai", () => ({ FilesetResolver: { forGenAiTasks: async () => ({}) }, LlmInference: { createFromOptions: () => mockCreate() } }));
jest.mock("@mlc-ai/web-llm", () => ({ CreateMLCEngine: () => mockCreate() }));
jest.mock("@/lib/mediapipe/storage", () => ({ isMediaPipeEnabled: () => mockBrowser === "mediapipe", getSelectedMediaPipeModelId: () => "gemma-3-1b" }));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: () => mockBrowser === "webllm" }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: () => false }));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: () => null }));
jest.mock("@/lib/scoring/cache", () => ({ computeProfileHash: () => "hash", computeScoringCacheKey: () => "key", lookupScoringCache: () => null, storeScoringCache: jest.fn() }));
jest.mock("@/lib/translation/cache", () => ({ lookupTranslation: async () => null, storeTranslation: jest.fn() }));
jest.mock("@sentry/nextjs", () => ({ startSpan: (_: unknown, fn: (span: unknown) => unknown) => fn({ setAttribute: jest.fn() }), captureException: jest.fn(), setTag: jest.fn() }));

import { runScoringCascade } from "@/contexts/content/scoring";
import { destroyInference, scoreWithMediaPipe } from "@/lib/mediapipe/engine";
import { destroyEngine, scoreWithWebLLM } from "@/lib/webllm/engine";
import { translateContent } from "@/lib/translation/engine";
import { LocalEngineBusyError, LocalEngineInitPendingError, LocalEngineTimeoutError, LocalEngineRecoveringError, LocalEngineUnavailableError } from "@/lib/localAI/budget";
import { _resetIcLlmCircuit } from "@/lib/ic/icLlmCircuitBreaker";
import type { _SERVICE } from "@/lib/ic/declarations";

const options = { text: "A detailed article about new scientific discoveries", targetLanguage: "ja" as const, backend: "auto" as const };
const score = JSON.stringify({ verdict: "quality", composite: 8 });
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  jest.useFakeTimers();
  await destroyInference();
  await destroyEngine();
  mockInstance = makeInstance();
  _resetIcLlmCircuit();
  mockCreate.mockReset().mockResolvedValue(mockInstance);
  mockGenerate.mockReset().mockResolvedValue(score);
  Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({}) }, configurable: true });
  globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ verdict: "quality", composite: 8 }) });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

describe.each(["mediapipe", "webllm"] as const)("%s cascade using real engine budgets", browser => {
  beforeEach(() => { mockBrowser = browser; });

  it.each(["init", "busy", "timeout"])("scoring reaches the next tier on %s", async stage => {
    let release!: (value: typeof mockInstance) => void;
    let finish!: (value: string) => void;
    let occupying: Promise<unknown> | undefined;
    if (stage === "init") mockCreate.mockReturnValue(new Promise(resolve => { release = resolve; }));
    else mockGenerate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    if (stage === "busy") {
      occupying = browser === "mediapipe" ? scoreWithMediaPipe("occupied", []) : scoreWithWebLLM("occupied", []);
      await jest.advanceTimersByTimeAsync(0);
    }
    const cascade = runScoringCascade("article", null, { current: null }, false);
    await jest.advanceTimersByTimeAsync(stage === "timeout" ? 45_000 : 15_000);
    expect(await cascade).toMatchObject({ scoringEngine: "claude-server" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    if (stage === "init") {
      expect(mockGenerate).not.toHaveBeenCalled();
      release(mockInstance);
    } else finish(score);
    await occupying;
    await jest.advanceTimersByTimeAsync(0);
  });

  it.each(["auto", "browser"] as const)("%s translation keeps slow initialization retryable", async backend => {
    let release!: (value: typeof mockInstance) => void;
    mockCreate.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const rejected = expect(translateContent({ ...options, backend })).rejects.toBeInstanceOf(LocalEngineInitPendingError);
    await jest.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(mockGenerate).not.toHaveBeenCalled();
    release(mockInstance);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockGenerate).not.toHaveBeenCalled();
    mockGenerate.mockResolvedValue("この記事は科学の進歩について説明しています。");
    await expect(translateContent({ ...options, backend })).resolves.toMatchObject({ backend: browser });
  });

  it("shares the queue between scoring and translation, and gives translation 60s", async () => {
    let finish!: (value: string) => void;
    mockGenerate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const translation = translateContent({ ...options, backend: "browser" });
    const rejected = expect(translation).rejects.toBeInstanceOf(LocalEngineTimeoutError);
    await jest.advanceTimersByTimeAsync(0);
    const scoreContent = browser === "mediapipe" ? scoreWithMediaPipe : scoreWithWebLLM;
    const busy = expect(scoreContent("article", [])).rejects.toBeInstanceOf(LocalEngineBusyError);
    await jest.advanceTimersByTimeAsync(15_000);
    await busy;
    let settled = false;
    void translation.catch(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(44_999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    const next = scoreContent("article", []);
    finish("遅れた翻訳です。");
    await jest.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toMatchObject({ verdict: "quality" });
  });

  it("queues scoring behind fast translation without falling to the server tier", async () => {
    mockGenerate.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve("これは翻訳された記事です。"), 1_000)));
    const translation = translateContent({ ...options, backend: "browser" });
    await jest.advanceTimersByTimeAsync(0);
    const cascade = runScoringCascade("article", null, { current: null }, false);
    await jest.advanceTimersByTimeAsync(1_000);
    await translation;
    expect(await cascade).toMatchObject({ scoringEngine: browser });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("serves scoring next when it arrives behind three queued translations", async () => {
    mockGenerate
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve("これは翻訳された記事です。"), 1_000)))
      .mockResolvedValueOnce(score)
      .mockResolvedValue("これは翻訳された記事です。");
    const active = translateContent({ ...options, backend: "browser" });
    await jest.advanceTimersByTimeAsync(0);
    const queued = Array.from({ length: 3 }, () => translateContent({ ...options, backend: "browser" }));
    await jest.advanceTimersByTimeAsync(0);
    const cascade = runScoringCascade("article", null, { current: null }, false);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await cascade).toMatchObject({ scoringEngine: browser });
    for (const translation of [active, ...queued]) {
      await expect(translation).resolves.toMatchObject({ backend: browser });
    }
    expect(mockGenerate).toHaveBeenCalledTimes(5);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("falls through recovering engines for scoring and Auto, and reports Browser recovery without reloading", async () => {
    mockGenerate.mockReturnValueOnce(new Promise(() => {}));
    const scoreContent = browser === "mediapipe" ? scoreWithMediaPipe : scoreWithWebLLM;
    const timedOut = expect(scoreContent("hung", [])).rejects.toBeInstanceOf(LocalEngineTimeoutError);
    await jest.advanceTimersByTimeAsync(50_000);
    await timedOut;
    const translateOnChain = jest.fn().mockResolvedValue({ ok: "これはフォールバックで翻訳された記事です。" });
    const actorRef = { current: { translateOnChain } as unknown as _SERVICE };
    for (let minute = 0; minute < 5; minute++) {
      await expect(runScoringCascade("article", null, { current: null }, false)).resolves.toMatchObject({ scoringEngine: "claude-server" });
      await expect(translateContent({ ...options, actorRef, isAuthenticated: true })).resolves.toMatchObject({ backend: "ic-llm" });
      await expect(translateContent({ ...options, backend: "browser" })).rejects.toBeInstanceOf(LocalEngineRecoveringError);
      await expect(translateContent(options)).rejects.toBeInstanceOf(LocalEngineRecoveringError);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(60_000);
    }
    mockInstance = makeInstance();
    mockCreate.mockResolvedValue(mockInstance);
    await expect(scoreContent("fresh", [])).resolves.toMatchObject({ composite: 8 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it.each(["WebGPU not available", "No GPU adapter found", "Memory error: model is too large for this device."])("Auto skips permanent init failure and Browser surfaces it: %s", async message => {
    mockCreate.mockRejectedValue(new Error(message));
    const translateOnChain = jest.fn().mockResolvedValue({ ok: "これはフォールバックで翻訳された記事です。" });
    const actorRef = { current: { translateOnChain } as unknown as _SERVICE };
    await expect(translateContent({ ...options, backend: "browser" })).rejects.toBeInstanceOf(LocalEngineUnavailableError);
    await expect(translateContent({ ...options, actorRef, isAuthenticated: true })).resolves.toMatchObject({ backend: "ic-llm" });
    await expect(translateContent(options)).resolves.toMatchObject({ status: "skip", reason: "all-backends-failed" });
    await expect(runScoringCascade("article", null, { current: null }, false)).resolves.toMatchObject({ scoringEngine: "claude-server" });
    await jest.advanceTimersByTimeAsync(600_000);
    await expect(translateContent({ ...options, backend: "browser" })).rejects.toBeInstanceOf(LocalEngineUnavailableError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it.each([true, false])("Auto tries IC after a local transient (IC success: %s)", async succeeds => {
    let release!: (value: typeof mockInstance) => void;
    mockCreate.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const translateOnChain = jest.fn().mockResolvedValue(succeeds ? { ok: "これはフォールバックで翻訳された記事です。" } : { err: "IC LLM translation failed" });
    const pending = translateContent({ ...options, isAuthenticated: true, actorRef: { current: { translateOnChain } as unknown as _SERVICE } });
    const expectation = succeeds
      ? expect(pending).resolves.toMatchObject({ backend: "ic-llm" })
      : expect(pending).rejects.toBeInstanceOf(LocalEngineInitPendingError);
    await jest.advanceTimersByTimeAsync(15_000);
    await expectation;
    expect(translateOnChain).toHaveBeenCalledTimes(1);
    release(mockInstance);
    await jest.advanceTimersByTimeAsync(0);
  });
});
