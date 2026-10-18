/** @jest-environment jsdom */

import { TextEncoder } from "node:util";
Object.assign(globalThis, { TextEncoder });
if (!AbortSignal.timeout) AbortSignal.timeout = () => new AbortController().signal;

import { act, cleanup, renderHook } from "@testing-library/react";
import { useTranslation } from "@/hooks/useTranslation";
import type { ContentItem } from "@/lib/types/content";
import { LocalEngineBusyError, resetLocalEngine } from "@/lib/localAI/budget";
import { translateContent } from "@/lib/translation/engine";
import type { TranslationBackend, TranslationLanguage } from "@/lib/translation/types";

const mockInit = jest.fn();
const mockInfer = jest.fn();
const mockNotify = jest.fn();
let mockBrowser: "mediapipe" | "webllm" = "mediapipe";
let mockBackend: TranslationBackend = "auto";
let mockLanguage: TranslationLanguage = "ja";
let mockApiKey: string | null = null;
const mockInterrupt = jest.fn();
const mockDestroy = jest.fn();
const makeInstance = () => ({
  cancelProcessing: mockInterrupt, interruptGenerate: mockInterrupt,
  generateResponse: mockInfer,
  chat: { completions: { create: async () => ({ choices: [{ message: { content: await mockInfer() } }] }) } },
});
let mockInstance = makeInstance();
jest.mock("@/contexts/PreferenceContext", () => ({ usePreferences: () => ({ profile: { translationPrefs: { targetLanguage: mockLanguage, policy: "all", backend: mockBackend, minScore: 6 } } }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: false }) }));
jest.mock("@/contexts/NotificationContext", () => ({ useNotify: () => ({ addNotification: mockNotify }) }));
jest.mock("@/lib/mediapipe/engine", () => ({ getOrCreateInference: () => mockInit(), destroyInference: mockDestroy }));
jest.mock("@/lib/webllm/engine", () => ({ getOrCreateEngine: () => mockInit(), destroyEngine: mockDestroy }));
jest.mock("@/lib/mediapipe/storage", () => ({ isMediaPipeEnabled: () => mockBrowser === "mediapipe" }));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: () => mockBrowser === "webllm" }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: () => false }));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: () => mockApiKey }));
jest.mock("@/lib/translation/cache", () => ({ lookupTranslation: async () => null, storeTranslation: jest.fn() }));
jest.mock("@sentry/nextjs", () => ({ startSpan: (_: unknown, fn: (span: unknown) => unknown) => fn({ setAttribute: jest.fn() }), captureException: jest.fn() }));

function harness(count: number) {
  const items: ContentItem[] = Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`, owner: "o", author: "a", avatar: "A",
    text: `An article describing scientific advances in field ${i}`,
    source: "rss", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
    verdict: "quality", reason: "", createdAt: 0, validated: false, flagged: false, timestamp: "now",
  }));
  const patch = jest.fn((id: string, update: Partial<ContentItem>) => Object.assign(items.find(item => item.id === id)!, update));
  const actorRef = { current: null };
  const hook = renderHook(() => useTranslation(items, patch, actorRef));
  return { ...hook, items, patch };
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  jest.useFakeTimers();
  mockInstance = makeInstance();
  mockInterrupt.mockReset();
  mockDestroy.mockReset();
  mockApiKey = null;
  mockLanguage = "ja";
  mockInit.mockReset().mockResolvedValue(mockInstance);
  mockInfer.mockReset().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("この記事は科学の進歩について説明しています。"), 1_000)));
  mockNotify.mockReset();
  mockBackend = "auto";
});
afterEach(() => {
  cleanup();
  resetLocalEngine(mockInstance);
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

describe.each(["mediapipe", "webllm"] as const)("%s translation retries with real budgets", browser => {
  beforeEach(() => { mockBrowser = browser; });

  it("completes four concurrent items sequentially in one fast-engine wave", async () => {
    const { result, items, patch } = harness(4);
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInfer).toHaveBeenCalledTimes(1);
    for (let completed = 1; completed <= 4; completed++) {
      await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
      expect(patch).toHaveBeenCalledTimes(completed);
      expect(patch.mock.calls[completed - 1][0]).toBe(`item-${completed - 1}`);
    }
    expect(items.every(item => item.translation?.backend === browser)).toBe(true);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("retries four init-pending items and completes all in the next wave", async () => {
    let loaded!: (value: typeof mockInstance) => void;
    mockInit.mockReturnValue(new Promise(resolve => { loaded = resolve; }));
    const { result, items, patch } = harness(4);
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
      await jest.advanceTimersByTimeAsync(15_000);
    });
    expect(mockInfer).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith(expect.stringContaining("still loading"), "info");
    await act(async () => {
      loaded(mockInstance);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInfer).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(49_000); });
    expect(mockInit).toHaveBeenCalledTimes(8);
    expect(patch).toHaveBeenCalledTimes(4);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("explicit Browser waiters become Busy after 15s on a slow engine, then retry", async () => {
    mockBackend = "browser";
    mockInfer.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve("これは翻訳した記事です。"), 20_000)));
    const { result, items, patch } = harness(4);
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
      await jest.advanceTimersByTimeAsync(14_999);
    });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockInfer).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(mockNotify).toHaveBeenCalledWith(expect.stringContaining("busy"), "info");
    await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(mockInfer).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(43_000); });
    expect(patch).toHaveBeenCalledTimes(4);
    expect(mockInfer).toHaveBeenCalledTimes(4);
  });

  it.each(["auto", "browser"] as const)("caps %s transient failures per item at three waves and still permits manual retry", async backend => {
    mockBackend = backend;
    mockInit.mockRejectedValue(new LocalEngineBusyError(browser));
    const { result, items, patch, rerender } = harness(2);
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(120_000); });
    expect(mockInit).toHaveBeenCalledTimes(6);
    expect(mockNotify).toHaveBeenCalledWith(expect.stringContaining("Translateで再試行"), "info");
    rerender();
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
      await jest.advanceTimersByTimeAsync(180_000);
    });
    expect(mockInit).toHaveBeenCalledTimes(6); // fourth and later waves stay terminal
    expect(patch).not.toHaveBeenCalled();
    mockInit.mockResolvedValue(mockInstance);
    await act(async () => {
      result.current.translateItem(items[0].id);
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(patch).toHaveBeenCalledTimes(1);
    mockLanguage = "fr";
    rerender();
    await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
    expect(patch).toHaveBeenCalledTimes(2); // new target language gets a fresh budget
  });

  it("interrupts a translation timeout and allows the next wave to use the slot", async () => {
    let cancelled!: (reason: Error) => void;
    mockInfer.mockImplementationOnce(() => new Promise((_, reject) => { cancelled = reject; }));
    mockInterrupt.mockImplementation(() => { cancelled(new Error("interrupted")); });
    const { result, items, patch } = harness(1);
    await act(async () => {
      result.current.requestAutoTranslate(items[0].id);
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(mockInterrupt).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(61_000); });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(mockInfer).toHaveBeenCalledTimes(2);
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it.each(["success", "already-in-target", "untranslatable", "definitive echo"])("Auto gives BYOK %s precedence and does not call BYOK again on periodic retry", async kind => {
    mockInit.mockRejectedValue(new LocalEngineBusyError(browser));
    mockApiKey = "test-key";
    if (kind === "definitive echo") mockLanguage = "fr";
    const { result, items, patch } = harness(1);
    const translation = kind === "success" ? "この記事は科学の進歩を説明しています。"
      : kind === "already-in-target" ? "ALREADY_IN_TARGET"
      : kind === "definitive echo" ? items[0].text : "Content cannot be translated";
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ translation }) });
    await act(async () => {
      result.current.requestAutoTranslate(items[0].id);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(kind === "success" ? 1 : 0);
    if (kind === "success") expect(items[0].translation?.backend).toBe("claude-byok");
    if (kind === "untranslatable" || kind === "definitive echo") {
      expect(mockNotify).toHaveBeenCalledWith(expect.stringContaining("Translateで再試行"), "info");
    }
    expect(mockNotify).not.toHaveBeenCalledWith(expect.stringContaining("retry automatically"), expect.anything());
    await act(async () => { await jest.advanceTimersByTimeAsync(240_000); });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it.each(["soft rejection", "transport failure"])("keeps local transient retryable when BYOK only has a %s", async kind => {
    const failure = new LocalEngineBusyError(browser);
    mockInit.mockRejectedValue(failure);
    mockApiKey = "test-key";
    globalThis.fetch = kind === "soft rejection"
      ? jest.fn().mockResolvedValue({ ok: true, json: async () => ({ translation: "x".repeat(1_000) }) })
      : jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(translateContent({ text: "An article describing scientific advances in a field", targetLanguage: "fr", backend: "auto" })).rejects.toBe(failure);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
