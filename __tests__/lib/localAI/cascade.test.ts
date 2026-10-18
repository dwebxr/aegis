/** @jest-environment jsdom */

import { TextEncoder } from "node:util";
Object.assign(globalThis, { TextEncoder });
if (!AbortSignal.timeout) AbortSignal.timeout = () => new AbortController().signal;

const mockCreate = jest.fn();
const mockGenerate = jest.fn();
let mockBrowser: "mediapipe" | "webllm" = "mediapipe";
const mockInstance = {
  generateResponse: mockGenerate,
  close: jest.fn(),
  chat: { completions: { create: async () => ({ choices: [{ message: { content: await mockGenerate() } }] }) } },
  unload: jest.fn().mockResolvedValue(undefined),
};
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
import { LocalEngineBusyError, LocalEngineInitPendingError, LocalEngineTimeoutError } from "@/lib/localAI/budget";
import { _resetIcLlmCircuit } from "@/lib/ic/icLlmCircuitBreaker";
import type { _SERVICE } from "@/lib/ic/declarations";

const options = { text: "A detailed article about new scientific discoveries", targetLanguage: "ja" as const, backend: "auto" as const };
const score = JSON.stringify({ verdict: "quality", composite: 8 });
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  jest.useFakeTimers();
  await destroyInference();
  await destroyEngine();
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
    await jest.advanceTimersByTimeAsync(stage === "init" ? 15_000 : stage === "timeout" ? 45_000 : 0);
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

  it("shares the busy guard between scoring and translation, and gives translation 60s", async () => {
    let finish!: (value: string) => void;
    mockGenerate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const translation = translateContent({ ...options, backend: "browser" });
    const rejected = expect(translation).rejects.toBeInstanceOf(LocalEngineTimeoutError);
    await jest.advanceTimersByTimeAsync(0);
    const scoreContent = browser === "mediapipe" ? scoreWithMediaPipe : scoreWithWebLLM;
    await expect(scoreContent("article", [])).rejects.toBeInstanceOf(LocalEngineBusyError);
    let settled = false;
    void translation.catch(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(59_999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    await expect(scoreContent("article", [])).rejects.toBeInstanceOf(LocalEngineBusyError);
    finish("遅れた翻訳です。");
    await jest.advanceTimersByTimeAsync(0);
    await expect(scoreContent("article", [])).resolves.toMatchObject({ verdict: "quality" });
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
