/**
 * @jest-environment jsdom
 */
import { TextEncoder as NodeTextEncoder } from "util";
import { webcrypto } from "crypto";
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder;
}
if (typeof globalThis.crypto?.subtle === "undefined") {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, writable: true });
}
if (typeof AbortSignal.timeout === "undefined") {
  AbortSignal.timeout = (ms: number) => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  };
}
// jsdom provides Response, but mocked fetch needs to return Response-like objects
function mockResponse(body: unknown, init?: { status?: number }): { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> } {
  const status = init?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

// Mock external dependencies before importing engine
let mockOllamaEnabled = false;
let mockWebLLMEnabled = false;
let mockMediaPipeEnabled = false;
let mockMediaPipeLoaded = false;
let mockApiKey: string | null = null;

jest.mock("@/lib/ollama/storage", () => ({
  isOllamaEnabled: () => mockOllamaEnabled,
  getOllamaConfig: () => ({ enabled: mockOllamaEnabled, endpoint: "http://localhost:11434", model: "llama3.2" }),
}));

jest.mock("@/lib/webllm/storage", () => ({
  isWebLLMEnabled: () => mockWebLLMEnabled,
}));

jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: () => mockApiKey,
}));

jest.mock("@/lib/webllm/engine", () => ({
  getOrCreateEngine: () => Promise.resolve({
    chat: {
      completions: {
        create: () => Promise.resolve({
          choices: [{ message: { content: "WebLLMで翻訳されました" } }],
        }),
      },
    },
  }),
  isWebLLMLoaded: () => mockWebLLMEnabled,
}));

jest.mock("@/lib/mediapipe/storage", () => ({
  isMediaPipeEnabled: () => mockMediaPipeEnabled,
}));

jest.mock("@/lib/mediapipe/engine", () => ({
  getOrCreateInference: () => Promise.resolve({
    generateResponse: () => Promise.resolve("MediaPipeで翻訳されました"),
  }),
  isMediaPipeLoaded: () => mockMediaPipeLoaded,
}));

jest.mock("@/lib/utils/timeout", () => ({
  withTimeout: (p: Promise<unknown>) => p,
}));

import { translateContent } from "@/lib/translation/engine";
import { storeTranslation } from "@/lib/translation/cache";
import type { TranslationResult } from "@/lib/translation/types";
import { _resetIcLlmCircuit } from "@/lib/ic/icLlmCircuitBreaker";

const origFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  mockOllamaEnabled = false;
  mockWebLLMEnabled = false;
  mockMediaPipeEnabled = false;
  mockMediaPipeLoaded = false;
  mockApiKey = null;
  globalThis.fetch = origFetch;
  // Circuit breaker state is a module-level singleton. Previous tests in
  // this file simulate consecutive ic-llm failures that trip the breaker
  // open — without resetting, later tests would find the cascade
  // skipping ic-llm entirely. Reset on every test.
  _resetIcLlmCircuit();
});

afterAll(() => {
  globalThis.fetch = origFetch;
});

function expectResult(r: Awaited<ReturnType<typeof translateContent>>): TranslationResult {
  expect(typeof r).toBe("object");
  return r as TranslationResult;
}

describe("translateContent", () => {
  it("returns cached result if available", async () => {
    const cached: TranslationResult = {
      translatedText: "キャッシュされた翻訳",
      targetLanguage: "ja",
      backend: "ollama",
      generatedAt: 1000,
    };
    await storeTranslation("Hello world", cached);

    const result = await translateContent({
      text: "Hello world",
      targetLanguage: "ja",
      backend: "local",
    });

    const r = expectResult(result);
    expect(r.translatedText).toBe("キャッシュされた翻訳");
    expect(expectResult(result).backend).toBe("ollama");
  });

  it("calls Ollama for 'local' backend", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockResponse({
        choices: [{ message: { content: "Ollamaで翻訳" } }],
      });
    });

    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "local",
    });

    const r = expectResult(result);
    expect(r.translatedText).toBe("Ollamaで翻訳");
    expect(expectResult(result).backend).toBe("ollama");
    expect(capturedBody).not.toBeNull();
    expect((capturedBody as unknown as Record<string, unknown>).model).toBe("llama3.2");
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain("/v1/chat/completions");
  });

  it("calls WebLLM for 'browser' backend", async () => {
    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "browser",
    });

    const r = expectResult(result);
    expect(r.translatedText).toBe("WebLLMで翻訳されました");
    expect(expectResult(result).backend).toBe("webllm");
  });

  it("calls MediaPipe for 'browser' backend when MediaPipe is enabled", async () => {
    mockMediaPipeEnabled = true;
    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "browser",
    });

    const r = expectResult(result);
    expect(r.translatedText).toBe("MediaPipeで翻訳されました");
    expect(r.backend).toBe("mediapipe");
  });

  it("falls back to WebLLM for 'browser' backend when MediaPipe is disabled", async () => {
    mockMediaPipeEnabled = false;
    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "browser",
    });

    const r = expectResult(result);
    expect(r.translatedText).toBe("WebLLMで翻訳されました");
    expect(r.backend).toBe("webllm");
  });

  it("calls /api/translate for 'cloud' backend with BYOK key", async () => {
    mockApiKey = "sk-ant-test-key";
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      );
      return mockResponse({ translation: "Claudeで翻訳" });
    });

    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "cloud",
    });

    const r = expectResult(result);
    expect(r.backend).toBe("claude-byok");
    expect(capturedHeaders["x-user-api-key"]).toBe("sk-ant-test-key");
  });

  it("uses 'claude-server' backend when no BYOK key for cloud", async () => {
    mockApiKey = null;
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      return mockResponse({ translation: "サーバー翻訳" });
    });

    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "cloud",
    });

    const r = expectResult(result);
    expect(r.backend).toBe("claude-server");
  });

  it("throws for 'ic' backend without authentication", async () => {
    await expect(translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "ic",
      isAuthenticated: false,
    })).rejects.toThrow("IC requires authentication");
  });

  it("calls IC actor for 'ic' backend with authentication", async () => {
    const mockTranslate = jest.fn().mockResolvedValue({ ok: "ICで翻訳しました" });
    const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "ic",
      actorRef,
      isAuthenticated: true,
    });

    const r = expectResult(result);
    expect(r.translatedText).toBe("ICで翻訳しました");
    expect(expectResult(result).backend).toBe("ic-llm");
    expect(mockTranslate).toHaveBeenCalled();
  });

  it("returns 'skip' when response is ALREADY_IN_TARGET", async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      return mockResponse({
        choices: [{ message: { content: "ALREADY_IN_TARGET" } }],
      });
    });

    const result = await translateContent({
      text: "Hello in English",
      targetLanguage: "en",
      backend: "local",
    });

    expect(result).toBe("skip");
  });

  it("explicit backend throws with named reason when response is empty", async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      return mockResponse({
        choices: [{ message: { content: "" } }],
      });
    });

    await expect(translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "local",
    })).rejects.toThrow(/Ollama returned an unusable response.*empty response/);
  });

  it("caches successful translation result", async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      return mockResponse({
        choices: [{ message: { content: "翻訳テスト" } }],
      });
    });

    await translateContent({ text: "Cache test", targetLanguage: "ja", backend: "local" });

    // Second call should use cache (not call fetch again)
    (globalThis.fetch as jest.Mock).mockClear();
    const result = await translateContent({ text: "Cache test", targetLanguage: "ja", backend: "local" });

    const r = expectResult(result);
    expect(r.translatedText).toBe("翻訳テスト");
    expect(globalThis.fetch as jest.Mock).not.toHaveBeenCalled();
  });

  it("throws when IC actor returns error result", async () => {
    const mockTranslate = jest.fn().mockResolvedValue({ err: "LLM overloaded" });
    const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

    await expect(translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "ic",
      actorRef,
      isAuthenticated: true,
    })).rejects.toThrow("LLM overloaded");
  });

  it("throws when IC actor ref is null", async () => {
    const actorRef = { current: null } as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

    await expect(translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "ic",
      actorRef,
      isAuthenticated: true,
    })).rejects.toThrow("IC actor not available");
  });

  it("throws on Ollama HTTP error", async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      return mockResponse({}, { status: 500 });
    });

    await expect(translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "local",
    })).rejects.toThrow("Ollama HTTP 500");
  });

  it("throws on Claude API HTTP error", async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      return mockResponse({}, { status: 429 });
    });

    await expect(translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "cloud",
    })).rejects.toThrow("Translate API HTTP 429");
  });

  describe("auto mode cascade", () => {
    it("tries Ollama first when enabled", async () => {
      mockOllamaEnabled = true;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({
          choices: [{ message: { content: "Ollamaで自動翻訳しました" } }],
        });
      });

      const result = await translateContent({
        text: "Auto test",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(expectResult(result).backend).toBe("ollama");
    });

    it("uses MediaPipe in auto cascade when enabled and loaded", async () => {
      mockMediaPipeEnabled = true;
      mockMediaPipeLoaded = true;
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("no server"));

      const result = await translateContent({
        text: "MediaPipe auto test",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(expectResult(result).backend).toBe("mediapipe");
    });

    it("skips MediaPipe in auto cascade when enabled but not loaded", async () => {
      mockMediaPipeEnabled = true;
      mockMediaPipeLoaded = false;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "サーバー翻訳" });
      });

      const result = await translateContent({
        text: "Skip unloaded MediaPipe",
        targetLanguage: "ja",
        backend: "auto",
      });

      // Should fall through to server Claude, not trigger MediaPipe download
      expect(expectResult(result).backend).toBe("claude-server");
    });

    it("prefers MediaPipe over WebLLM in auto cascade (mutual exclusion)", async () => {
      mockMediaPipeEnabled = true;
      mockMediaPipeLoaded = true;
      mockWebLLMEnabled = true;

      const result = await translateContent({
        text: "MediaPipe vs WebLLM",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(expectResult(result).backend).toBe("mediapipe");
    });

    it("falls back to WebLLM when Ollama fails", async () => {
      mockOllamaEnabled = true;
      mockWebLLMEnabled = true;
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("Ollama down"));

      const result = await translateContent({
        text: "Fallback test",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(expectResult(result).backend).toBe("webllm");
      expect(expectResult(result).translatedText).toBe("WebLLMで翻訳されました");
    });

    it("falls through to server Claude when all local backends fail", async () => {
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "サーバーフォールバック" });
      });

      const result = await translateContent({
        text: "Server fallback",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(expectResult(result).backend).toBe("claude-server");
    });

    it("includes IC LLM in auto cascade when authenticated", async () => {
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      const mockTranslate = jest.fn().mockResolvedValue({ ok: "ICで自動翻訳しました" });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      // Mock server Claude to fail so IC gets tried
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("no server"));

      const result = await translateContent({
        text: "IC auto test",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(expectResult(result).backend).toBe("ic-llm");
      expect(mockTranslate).toHaveBeenCalled();
    });

    it("throws diagnostic error when all backends fail in auto cascade", async () => {
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("All failed"));

      // Auto cascade only tries claude-server here (no IC actor, no
      // BYOK key, no local backends enabled). After exhausting, it
      // throws with the failure reason from the last attempt.
      await expect(translateContent({
        text: "All fail test",
        targetLanguage: "ja",
        backend: "auto",
      })).rejects.toThrow(/Translation backend failed.*claude-server.*All failed/);
    });
  });

  describe("reason translation", () => {
    it("includes translatedReason when LLM returns JSON with reason", async () => {
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({
          choices: [{ message: { content: '{"text":"翻訳テキスト","reason":"翻訳理由"}' } }],
        });
      });

      const result = await translateContent({
        text: "Hello",
        reason: "Good analysis",
        targetLanguage: "ja",
        backend: "local",
      });

      const r = expectResult(result);
      expect(r.translatedText).toBe("翻訳テキスト");
      expect(r.translatedReason).toBe("翻訳理由");
    });

    it("handles plain text response even when reason was provided", async () => {
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({
          choices: [{ message: { content: "プレーンテキスト翻訳" } }],
        });
      });

      const result = await translateContent({
        text: "Hello",
        reason: "Some reason",
        targetLanguage: "ja",
        backend: "local",
      });

      const r = expectResult(result);
      expect(r.translatedText).toBe("プレーンテキスト翻訳");
      expect(r.translatedReason).toBeUndefined();
    });

    it("returns null for ALREADY_IN_TARGET via parseTranslationResponse", async () => {
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({
          choices: [{ message: { content: "ALREADY_IN_TARGET" } }],
        });
      });

      const result = await translateContent({
        text: "既に日本語",
        reason: "理由",
        targetLanguage: "ja",
        backend: "local",
      });

      expect(result).toBe("skip");
    });
  });

  describe("validator integration — auto cascade fall-through", () => {
    it("auto cascade falls through to next backend when output fails kana check", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      // IC LLM returns English (no kana) → validator rejects → cascade falls
      // through to server Claude which returns valid Japanese.
      const mockTranslate = jest.fn().mockResolvedValue({
        ok: "Apple announced a new product (no kana, validator rejects this)",
      });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      const r = expectResult(result);
      expect(r.backend).toBe("claude-server");
      expect(r.translatedText).toBe("Appleが新製品を発表しました。");
      expect(mockTranslate).toHaveBeenCalled();
    });

    it("auto cascade RECOVERS meta-prefix from IC LLM output instead of falling through", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      const mockTranslate = jest.fn().mockResolvedValue({
        ok: "Here is the translation: アップルが新製品を発表しました。",
      });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      const claudeMock = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "should not be called" });
      });
      globalThis.fetch = claudeMock;

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      const r = expectResult(result);
      // Meta-prefix is stripped by parseTranslationResponse, the validator
      // accepts the recovered Japanese, and IC LLM "wins" the cascade.
      expect(r.backend).toBe("ic-llm");
      expect(r.translatedText).toBe("アップルが新製品を発表しました。");
      expect(claudeMock).not.toHaveBeenCalled();
    });

    it("auto cascade still falls through when output is unrecoverable English (no kana)", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      const mockTranslate = jest.fn().mockResolvedValue({
        ok: "I cannot translate this text into Japanese for you.",
      });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      const r = expectResult(result);
      expect(r.backend).toBe("claude-server");
    });

    it("auto cascade throws diagnostic error when both backends fail with non-skip reasons", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      const mockTranslate = jest.fn().mockResolvedValue({
        ok: "English only output without any kana characters",
      });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      // claude-server returns HTTP 502 (transport error, not validator
      // rejection — so the smart-model "skip" exception does NOT apply).
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: "upstream" }),
        text: () => Promise.resolve("upstream"),
      });

      // ic-llm rejected by validator (no kana), claude-server failed
      // transport. Cascade exhausts and throws with both names + reasons.
      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      })).rejects.toThrow(/All 2 translation backends failed.*ic-llm.*no kana.*claude-server.*HTTP 502/);
    });

    it("explicit IC backend throws with named reason on validator rejection", async () => {
      const mockTranslate = jest.fn().mockResolvedValue({
        ok: "English without any kana for ja target",
      });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "ic",
        actorRef,
        isAuthenticated: true,
      })).rejects.toThrow(/IC LLM returned an unusable response.*no kana.*switch.*Auto/i);
    });

    it("translateWithIC retries once on transient 'IC LLM translation failed' error", async () => {
      const mockTranslate = jest.fn()
        .mockResolvedValueOnce({ err: "IC LLM translation failed" })
        .mockResolvedValueOnce({ ok: "リトライ後の翻訳が成功しました" });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "ic",
        actorRef,
        isAuthenticated: true,
      });

      const r = expectResult(result);
      expect(r.translatedText).toBe("リトライ後の翻訳が成功しました");
      expect(r.backend).toBe("ic-llm");
      expect(mockTranslate).toHaveBeenCalledTimes(2);
    });

    it("translateWithIC retries once on 'IC LLM returned empty response' error", async () => {
      const mockTranslate = jest.fn()
        .mockResolvedValueOnce({ err: "IC LLM returned empty response" })
        .mockResolvedValueOnce({ ok: "リトライ後の翻訳です" });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "ic",
        actorRef,
        isAuthenticated: true,
      });

      expect(expectResult(result).backend).toBe("ic-llm");
      expect(mockTranslate).toHaveBeenCalledTimes(2);
    });

    it("translateWithIC propagates failure when retry also fails", async () => {
      const mockTranslate = jest.fn()
        .mockResolvedValue({ err: "IC LLM translation failed" });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "ic",
        actorRef,
        isAuthenticated: true,
      })).rejects.toThrow(/IC LLM unavailable.*retried once/);

      expect(mockTranslate).toHaveBeenCalledTimes(2);
    });

    it("translateWithIC does NOT retry on auth errors", async () => {
      const mockTranslate = jest.fn()
        .mockResolvedValue({ err: "Authentication required" });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "ic",
        actorRef,
        isAuthenticated: true,
      })).rejects.toThrow(/Authentication required/);

      // Only called once — not retried because the error doesn't match the
      // transient-failure pattern.
      expect(mockTranslate).toHaveBeenCalledTimes(1);
    });

    it("auto cascade promotes claude-server no-kana to 'skip' ONLY when ic-llm was tried", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      const mockTranslate = jest.fn().mockResolvedValue({
        ok: "Apple announced a new product (no kana from IC LLM)",
      });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      // Claude server returns text without kana — likely the input is
      // untranslatable (URL, code, single token). With ic-llm in the
      // cascade (authenticated + actor ready), this is treated as skip.
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "https://example.com/some-url" });
      });

      const result = await translateContent({
        text: "https://example.com/some-url",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(result).toBe("skip");
    });

    it("auto cascade does NOT promote claude-server no-kana to skip when ic-llm was NOT in cascade (cold-start)", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      // Cold-start scenario: user is authenticated but actorRef.current
      // is still null because createBackendActorAsync hasn't resolved yet.
      // The cascade only includes claude-server. Claude returns no-kana.
      // The conditional skip exception should NOT fire because the user's
      // preferred backend (ic-llm) never got a chance — instead the
      // cascade should throw so the actor-ready retry hook can re-run
      // it once the actor is ready.
      const actorRef = { current: null } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "Apple announced a new product." });
      });

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      })).rejects.toThrow(/Translation backend failed.*claude-server.*no kana/);
    });

    it("auto cascade does NOT promote IC LLM no-kana to skip (only Claude is trusted)", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      const mockTranslate = jest.fn().mockResolvedValue({
        ok: "English without kana from the 8B model",
      });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      // After IC LLM rejection, the cascade falls through to claude-server.
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      const r = expectResult(result);
      expect(r.backend).toBe("claude-server");
    });

    it("auto cascade short-circuits on ALREADY_IN_TARGET (does not retry later backends)", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      const mockTranslate = jest.fn().mockResolvedValue({ ok: "ALREADY_IN_TARGET" });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      const claudeMock = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "should never be called" });
      });
      globalThis.fetch = claudeMock;

      const result = await translateContent({
        text: "既に日本語のテキスト",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(result).toBe("skip");
      expect(mockTranslate).toHaveBeenCalled();
      expect(claudeMock).not.toHaveBeenCalled();
    });
  });

  describe("circuit breaker integration", () => {
    it("cascade skips ic-llm entirely when breaker is open", async () => {
      // Trip the breaker: 3 consecutive ic-llm failures
      const failingTranslate = jest.fn().mockResolvedValue({ err: "IC LLM translation failed" });
      const actorRef = { current: { translateOnChain: failingTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      const claudeMock = jest.fn().mockImplementation(async () => mockResponse({
        translation: "クロードで翻訳",
      }));
      globalThis.fetch = claudeMock;

      for (let i = 0; i < 3; i++) {
        await translateContent({
          text: `Trip ${i} ${Math.random()}`,
          targetLanguage: "ja",
          backend: "auto",
          actorRef,
          isAuthenticated: true,
        });
      }
      expect(failingTranslate).toHaveBeenCalledTimes(3);

      // Next cascade: should skip ic-llm entirely
      failingTranslate.mockClear();
      const result = await translateContent({
        text: "After breaker tripped",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(failingTranslate).not.toHaveBeenCalled();
      expect(expectResult(result).backend).toBe("claude-server");
    });

    it("skip is recorded in the translation debug log with circuit description", async () => {
      const { getTranslationDebugLog } = await import("@/lib/translation/debugLog");
      const { recordIcLlmFailure } = await import("@/lib/ic/icLlmCircuitBreaker");
      recordIcLlmFailure();
      recordIcLlmFailure();
      recordIcLlmFailure();

      const actorRef = { current: { translateOnChain: jest.fn() } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockResolvedValue(mockResponse({ translation: "翻訳" }));

      await translateContent({
        text: "Breaker skip should log an entry",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      const entries = getTranslationDebugLog();
      const skipEntry = entries.find(e => e.backend === "ic-llm" && e.outcome === "skip");
      expect(skipEntry).toBeDefined();
      expect(skipEntry!.reason).toMatch(/circuit open/);
      expect(skipEntry!.elapsedMs).toBe(0);
    });

    it("successful ic-llm call closes the breaker after a partial failure streak", async () => {
      const { _icLlmCircuitFailures, _icLlmCircuitState } = await import("@/lib/ic/icLlmCircuitBreaker");

      // Two ic-llm failures (below threshold of 3), then one success
      const mockTranslate = jest.fn()
        .mockResolvedValueOnce({ err: "IC LLM translation failed" })
        .mockResolvedValueOnce({ err: "IC LLM translation failed" })
        .mockResolvedValueOnce({ ok: "成功した翻訳結果" });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockResolvedValue(mockResponse({ translation: "フォールバック" }));

      await translateContent({ text: "fail 1", targetLanguage: "ja", backend: "auto", actorRef, isAuthenticated: true });
      await translateContent({ text: "fail 2", targetLanguage: "ja", backend: "auto", actorRef, isAuthenticated: true });
      expect(_icLlmCircuitFailures()).toBe(2);
      expect(_icLlmCircuitState()).toBe("closed");

      const result = await translateContent({ text: "succeed", targetLanguage: "ja", backend: "auto", actorRef, isAuthenticated: true });
      expect(expectResult(result).backend).toBe("ic-llm");
      expect(_icLlmCircuitFailures()).toBe(0);
      expect(_icLlmCircuitState()).toBe("closed");
    });

    it("validator rejection does not count as a breaker failure", async () => {
      const { _icLlmCircuitFailures } = await import("@/lib/ic/icLlmCircuitBreaker");

      // IC returns a raw string but no kana → validator rejects
      const mockTranslate = jest.fn().mockResolvedValue({ ok: "Hello world (no kana)" });
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockResolvedValue(mockResponse({ translation: "クロードで翻訳しました" }));

      await translateContent({ text: "validator rejects", targetLanguage: "ja", backend: "auto", actorRef, isAuthenticated: true });

      // Canister returned ok — breaker saw success, counter is 0
      expect(_icLlmCircuitFailures()).toBe(0);
    });

    it("ic-llm transport throw records a failure", async () => {
      const { _icLlmCircuitFailures } = await import("@/lib/ic/icLlmCircuitBreaker");
      const mockTranslate = jest.fn().mockRejectedValue(new Error("Call failed: canister trap"));
      const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockResolvedValue(mockResponse({ translation: "クロード" }));

      await translateContent({ text: "throw", targetLanguage: "ja", backend: "auto", actorRef, isAuthenticated: true });
      expect(_icLlmCircuitFailures()).toBe(1);
    });
  });
});
