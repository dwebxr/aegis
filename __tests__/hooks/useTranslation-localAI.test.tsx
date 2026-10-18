/** @jest-environment jsdom */

import { TextEncoder } from "node:util";
Object.assign(globalThis, { TextEncoder });

import { act, cleanup, renderHook } from "@testing-library/react";
import { useTranslation } from "@/hooks/useTranslation";
import type { ContentItem } from "@/lib/types/content";
import type { TranslationBackend } from "@/lib/translation/types";

const mockInit = jest.fn();
const mockInfer = jest.fn();
const mockNotify = jest.fn();
let mockBrowser: "mediapipe" | "webllm" = "mediapipe";
let mockBackend: TranslationBackend = "auto";
const mockInstance = {
  generateResponse: mockInfer,
  chat: { completions: { create: async () => ({ choices: [{ message: { content: await mockInfer() } }] }) } },
};
jest.mock("@/contexts/PreferenceContext", () => ({ usePreferences: () => ({ profile: { translationPrefs: { targetLanguage: "ja", policy: "all", backend: mockBackend, minScore: 6 } } }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: false }) }));
jest.mock("@/contexts/NotificationContext", () => ({ useNotify: () => ({ addNotification: mockNotify }) }));
jest.mock("@/lib/mediapipe/engine", () => ({ getOrCreateInference: () => mockInit() }));
jest.mock("@/lib/webllm/engine", () => ({ getOrCreateEngine: () => mockInit() }));
jest.mock("@/lib/mediapipe/storage", () => ({ isMediaPipeEnabled: () => mockBrowser === "mediapipe" }));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: () => mockBrowser === "webllm" }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: () => false }));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: () => null }));
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

beforeEach(() => {
  jest.useFakeTimers();
  mockInit.mockReset().mockResolvedValue(mockInstance);
  mockInfer.mockReset().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("この記事は科学の進歩について説明しています。"), 1_000)));
  mockNotify.mockReset();
  mockBackend = "auto";
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(["mediapipe", "webllm"] as const)("%s translation retries with real budgets", browser => {
  beforeEach(() => { mockBrowser = browser; });

  it("retries four Auto items after init-pending and busy failures until all succeed", async () => {
    let loaded!: (value: typeof mockInstance) => void;
    const init = new Promise(resolve => { loaded = resolve; });
    mockInit.mockReturnValue(init);
    const { result, items, patch } = harness(4);
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInit).toHaveBeenCalledTimes(4);
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(mockInfer).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith(expect.stringContaining("still loading"), "info");
    await act(async () => {
      loaded(mockInstance);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockInfer).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(45_000); });
    expect(mockInit).toHaveBeenCalledTimes(8);
    expect(mockInfer).toHaveBeenCalledTimes(1);
    // One engine slot is free per retry wave; the other items stay retryable.
    for (let completed = 1; completed <= 4; completed++) {
      await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
      expect(patch).toHaveBeenCalledTimes(completed);
      if (completed < 4) {
        await act(async () => { await jest.advanceTimersByTimeAsync(59_000); });
      }
    }
    expect(items.every(item => item.translation?.backend === browser)).toBe(true);
    expect(mockInfer).toHaveBeenCalledTimes(4);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).not.toHaveBeenCalledWith(expect.stringMatching(/unavailable|バックエンド/), expect.anything());
  });

  it("explicit Browser reports busy and periodically retries the failed item", async () => {
    mockBackend = "browser";
    const { result, items, patch } = harness(2);
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockNotify).toHaveBeenCalledWith(expect.stringContaining("busy"), "info");
    expect(mockInfer).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
    expect(patch).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});
