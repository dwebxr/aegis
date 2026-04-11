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

  it("throws with BYOK-required error when 'cloud' is picked without a user API key", async () => {
    // Hotfix 17: claude-server is no longer reachable via the 'cloud'
    // backend without an explicit BYOK key. Previously this silently
    // burned the operator's Anthropic budget on every user without a
    // key; now it throws an actionable error telling the user how to
    // either configure BYOK or pick a different engine.
    mockApiKey = null;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;

    await expect(translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "cloud",
    })).rejects.toThrow(/Claude \(Cloud\) requires an Anthropic API key/);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("throws on Claude API HTTP error when cloud is picked with BYOK", async () => {
    mockApiKey = "sk-ant-test-key";
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

    it("skips MediaPipe in auto cascade when enabled but not loaded (silent skip, no MediaPipe download)", async () => {
      mockMediaPipeEnabled = true;
      mockMediaPipeLoaded = false;
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      // With no loaded local backend and no BYOK, the cascade is empty
      // post-hotfix-17 (claude-server no longer a free fallback) →
      // silent skip, no MediaPipe download triggered.
      const fetchSpy = jest.fn();
      globalThis.fetch = fetchSpy;

      const result = await translateContent({
        text: "Skip unloaded MediaPipe",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(result).toBe("skip");
      expect(fetchSpy).not.toHaveBeenCalled();
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

    it("silently skips when no backends are configured (anonymous user, no local, no BYOK)", async () => {
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockMediaPipeEnabled = false;
      mockApiKey = null;
      const fetchSpy = jest.fn();
      globalThis.fetch = fetchSpy;

      const result = await translateContent({
        text: "Nothing configured",
        targetLanguage: "ja",
        backend: "auto",
      });

      // Empty cascade → silent skip → user sees original text, no
      // error notification, no API hit
      expect(result).toBe("skip");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("uses ic-llm in auto cascade for authenticated users with no other backends", async () => {
      // Hotfix 17: IC LLM is the authenticated-user fallback in the
      // auto cascade. Claude-server is NOT in the auto cascade (cost
      // control), and IC LLM offers free on-chain translation for
      // the ~42% of items it can handle.
      const { _resetIcLlmCircuit } = await import("@/lib/ic/icLlmCircuitBreaker");
      _resetIcLlmCircuit();
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      const icMock = jest.fn().mockResolvedValue({ ok: "ICで翻訳しました" });
      const actorRef = { current: { translateOnChain: icMock } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      const fetchSpy = jest.fn();
      globalThis.fetch = fetchSpy;

      const result = await translateContent({
        text: "Auto should use ic-llm for authenticated users",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(expectResult(result).backend).toBe("ic-llm");
      expect(icMock).toHaveBeenCalled();
      // Confirm claude-server was NOT consulted — no fetch to /api/translate
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does NOT include ic-llm in auto cascade for anonymous users", async () => {
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      const icMock = jest.fn().mockResolvedValue({ ok: "IC should NOT be called" });
      const actorRef = { current: { translateOnChain: icMock } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      const result = await translateContent({
        text: "Anonymous auto",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: false,
      });

      expect(result).toBe("skip");
      expect(icMock).not.toHaveBeenCalled();
    });

    it("does NOT include ic-llm in auto cascade when circuit breaker is open", async () => {
      const { recordIcLlmFailure, _resetIcLlmCircuit } = await import("@/lib/ic/icLlmCircuitBreaker");
      _resetIcLlmCircuit();
      recordIcLlmFailure();
      recordIcLlmFailure();
      recordIcLlmFailure();

      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      const icMock = jest.fn();
      const actorRef = { current: { translateOnChain: icMock } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      const result = await translateContent({
        text: "Breaker open",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(result).toBe("skip");
      expect(icMock).not.toHaveBeenCalled();
      _resetIcLlmCircuit();
    });

    it("throws diagnostic error when all backends in auto cascade fail with transport errors", async () => {
      const { _resetIcLlmCircuit } = await import("@/lib/ic/icLlmCircuitBreaker");
      _resetIcLlmCircuit();
      mockOllamaEnabled = true;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      // Ollama throws a recognizable network-level error (iOS Safari's
      // `TypeError: Load failed` matches the transport-error regex) so
      // the cascade treats it as a real infrastructure problem and
      // throws — giving the user visibility rather than silently
      // marking the item unreachable.
      globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Load failed"));

      await expect(translateContent({
        text: "All fail test",
        targetLanguage: "ja",
        backend: "auto",
      })).rejects.toThrow(/Translation backend failed.*ollama.*Load failed/);
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
    it("auto cascade falls through from ollama to claude-byok on validator rejection", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      // Ollama returns English (no kana) → validator rejects → cascade
      // falls through to claude-byok which returns valid Japanese.
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: "English without any kana" } }] });
        }
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
      });

      const r = expectResult(result);
      expect(r.backend).toBe("claude-byok");
      expect(r.translatedText).toBe("Appleが新製品を発表しました。");
    });

    it("auto cascade RECOVERS meta-prefix from local backend output instead of falling through", async () => {
      mockOllamaEnabled = true;
      mockApiKey = null;
      // Ollama returns a meta-prefix + valid Japanese. stripLeadingMeta
      // in parseTranslationResponse recovers the real payload, so the
      // validator accepts it and the cascade short-circuits.
      const claudeCalls = jest.fn();
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: "Here is the translation: アップルが新製品を発表しました。" } }] });
        }
        claudeCalls();
        return mockResponse({ translation: "should not be called" });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
      });

      const r = expectResult(result);
      expect(r.backend).toBe("ollama");
      expect(r.translatedText).toBe("アップルが新製品を発表しました。");
      expect(claudeCalls).not.toHaveBeenCalled();
    });

    it("auto cascade still falls through when local backend returns unrecoverable English (no kana)", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: "I cannot translate this text into Japanese for you." } }] });
        }
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
      });

      const r = expectResult(result);
      expect(r.backend).toBe("claude-byok");
    });

    it("auto cascade throws diagnostic error when both transport attempts fail", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      // Ollama throws a network error, claude-byok throws HTTP 502 —
      // both are transport-level failures, so the cascade should
      // surface the error (not silent-skip) so the user knows
      // their backends are broken.
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          throw new Error("Load failed");
        }
        return {
          ok: false,
          status: 502,
          json: () => Promise.resolve({ error: "upstream" }),
          text: () => Promise.resolve("upstream"),
        };
      });

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
      })).rejects.toThrow(/All 2 translation backends failed.*ollama.*claude-byok.*HTTP 502/);
    });

    it("auto cascade silently skips when a validator rejection is the only outcome (non-transport)", async () => {
      mockOllamaEnabled = true;
      mockApiKey = null;
      // Ollama returns meta-commentary that the validator rejects.
      // There's no BYOK and no IC actor, so the cascade ends with a
      // single validator-level failure. Hotfix 17: silent skip to
      // stop the retry-loop waste on untranslatable content.
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ choices: [{ message: { content: "Here is the translation of the text that I am not going to translate" } }] });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(result).toBe("skip");
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

    it("auto cascade promotes claude-byok no-kana to 'skip' for ja target", async () => {
      mockOllamaEnabled = false;
      mockApiKey = "sk-ant-test-key";
      // Claude-byok returns text without kana for a ja target — e.g.
      // input was a URL / code / already-Japanese content the model
      // didn't recognize. Treat this as a definitive untranslatable
      // verdict and promote to skip so the retry loop doesn't keep
      // banging on the same item.
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "https://example.com/some-url" });
      });

      const result = await translateContent({
        text: "https://example.com/some-url",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(result).toBe("skip");
    });

    it("auto cascade short-circuits on ALREADY_IN_TARGET from a local backend (does not retry later backends)", async () => {
      mockOllamaEnabled = true;
      mockApiKey = null;
      const claudeCalls = jest.fn();
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: "ALREADY_IN_TARGET" } }] });
        }
        claudeCalls();
        return mockResponse({ translation: "should never be called" });
      });

      const result = await translateContent({
        text: "既に日本語のテキスト",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(result).toBe("skip");
      expect(claudeCalls).not.toHaveBeenCalled();
    });

    it("auto cascade promotes 'identical to input' to skip for any target language (via claude-byok)", async () => {
      // Claude-byok echoes input verbatim for URLs / filenames /
      // untranslatable content. Hotfix 16 promoted this to skip so
      // the retry loop doesn't burn API on doomed calls.
      mockOllamaEnabled = false;
      mockApiKey = "sk-ant-test-key";
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "https://example.com/foo/bar" });
      });

      const result = await translateContent({
        text: "https://example.com/foo/bar",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(result).toBe("skip");
    });

    it("auto cascade promotes 'identical to input' to skip for non-ja targets too (fr, via claude-byok)", async () => {
      mockOllamaEnabled = false;
      mockApiKey = "sk-ant-test-key";
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "function foo() { return 42; }" });
      });

      const result = await translateContent({
        text: "function foo() { return 42; }",
        targetLanguage: "fr",
        backend: "auto",
      });

      expect(result).toBe("skip");
    });

    it("auto cascade promotes 'identical to input' to skip even from a local backend", async () => {
      mockOllamaEnabled = true;
      mockApiKey = null;
      const claudeCalls = jest.fn();
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: "https://example.com/foo" } }] });
        }
        claudeCalls();
        return mockResponse({ translation: "should not be called" });
      });

      const result = await translateContent({
        text: "https://example.com/foo",
        targetLanguage: "fr",
        backend: "auto",
      });

      expect(result).toBe("skip");
      // Skip is definitive — later backends are not tried
      expect(claudeCalls).not.toHaveBeenCalled();
    });
  });

  describe("claude-byok transient fetch retry", () => {
    // Hotfix 17: auto cascade no longer reaches claude-server. These
    // retry tests now drive the path via `backend: "cloud"` with a
    // BYOK key configured, which exercises the same `translateWithClaude`
    // → `callClaudeOnce` retry wrapper.
    it("retries once when fetch throws 'Load failed' (iOS Safari transient)", async () => {
      mockApiKey = "sk-ant-test-key";
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new TypeError("Load failed");
        }
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "cloud",
      });

      expect(expectResult(result).backend).toBe("claude-byok");
      expect(callCount).toBe(2);
    });

    it("retries once on 'Failed to fetch' (Chrome/Edge network error)", async () => {
      mockApiKey = "sk-ant-test-key";
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) throw new TypeError("Failed to fetch");
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced",
        targetLanguage: "ja",
        backend: "cloud",
      });
      expect(expectResult(result).backend).toBe("claude-byok");
      expect(callCount).toBe(2);
    });

    it("retries once on 'NetworkError when attempting to fetch resource' (Firefox)", async () => {
      mockApiKey = "sk-ant-test-key";
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) throw new Error("NetworkError when attempting to fetch resource");
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      await translateContent({ text: "foo", targetLanguage: "ja", backend: "cloud" });
      expect(callCount).toBe(2);
    });

    it("does NOT retry on AbortError (the timeout we explicitly wired)", async () => {
      mockApiKey = "sk-ant-test-key";
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      const fetchMock = jest.fn().mockRejectedValue(abortErr);
      globalThis.fetch = fetchMock;

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "cloud",
      })).rejects.toThrow(/aborted/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on HTTP 429 rate-limit (deterministic server response)", async () => {
      mockApiKey = "sk-ant-test-key";
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: "rate limited" }),
        text: () => Promise.resolve("rate limited"),
      });
      globalThis.fetch = fetchMock;

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "cloud",
      })).rejects.toThrow(/HTTP 429/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("propagates the error when BOTH attempts throw transient fetch errors", async () => {
      mockApiKey = "sk-ant-test-key";
      const fetchMock = jest.fn().mockRejectedValue(new TypeError("Load failed"));
      globalThis.fetch = fetchMock;

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "cloud",
      })).rejects.toThrow(/Load failed/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("auto cascade ordering & mixed outcomes", () => {
    it("tries ollama BEFORE claude-byok when both are configured", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      const callOrder: string[] = [];
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          callOrder.push("ollama");
          return mockResponse({ choices: [{ message: { content: "オラマで翻訳しました。" } }] });
        }
        callOrder.push("claude");
        return mockResponse({ translation: "should not be called" });
      });

      const result = await translateContent({
        text: "Apple announced a new product.",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(expectResult(result).backend).toBe("ollama");
      expect(callOrder).toEqual(["ollama"]);
    });

    it("tries claude-byok BEFORE ic-llm when both are in cascade", async () => {
      const { _resetIcLlmCircuit } = await import("@/lib/ic/icLlmCircuitBreaker");
      _resetIcLlmCircuit();
      mockApiKey = "sk-ant-test-key";
      const icCalls = jest.fn();
      const actorRef = {
        current: {
          translateOnChain: jest.fn().mockImplementation(async () => {
            icCalls();
            return { ok: "should not be called" };
          }),
        },
      } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockResolvedValue(
        mockResponse({ translation: "クロードで翻訳しました。" }),
      );

      const result = await translateContent({
        text: "Apple announced a new product.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(expectResult(result).backend).toBe("claude-byok");
      expect(icCalls).not.toHaveBeenCalled();
    });

    it("falls through ollama (soft validator fail) to claude-byok (success)", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          // Ollama returns English — no-kana validator failure, but ollama
          // is not the smart-model claude-byok so this is NOT promoted to
          // skip. Cascade falls through to claude-byok.
          return mockResponse({ choices: [{ message: { content: "English with no kana" } }] });
        }
        return mockResponse({ translation: "アップルが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced a new product.",
        targetLanguage: "ja",
        backend: "auto",
      });

      const r = expectResult(result);
      expect(r.backend).toBe("claude-byok");
      expect(r.translatedText).toBe("アップルが新製品を発表しました。");
    });

    it("ollama soft-fail + claude-byok no-kana promotes to skip (smart-model exception fires)", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: "Ollama English output" } }] });
        }
        return mockResponse({ translation: "Claude also returned English output" });
      });

      const result = await translateContent({
        text: "Apple announced a new product.",
        targetLanguage: "ja",
        backend: "auto",
      });

      // Ollama's no-kana is NOT promoted (not a smart model), cascade
      // continues. Claude-byok's no-kana IS promoted → skip.
      expect(result).toBe("skip");
    });

    it("identical-to-input from ic-llm promotes to skip", async () => {
      const { _resetIcLlmCircuit } = await import("@/lib/ic/icLlmCircuitBreaker");
      _resetIcLlmCircuit();
      const url = "https://example.com/some-very-long-url-path/to/an/article";
      const actorRef = {
        current: {
          translateOnChain: jest.fn().mockResolvedValue({ ok: url }),
        },
      } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

      const result = await translateContent({
        text: url,
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(result).toBe("skip");
    });

    it("empty raw response from a cascade backend is NOT promoted to skip, falls through", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: "" } }] });
        }
        return mockResponse({ translation: "アップルが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced a new product.",
        targetLanguage: "ja",
        backend: "auto",
      });

      // Empty response is a "failed" outcome with reason "empty response" —
      // not one of the definitive skip promotions — so cascade continues.
      expect(expectResult(result).backend).toBe("claude-byok");
    });

    it("records ic-llm success to breaker when it wins the auto cascade", async () => {
      const { _resetIcLlmCircuit, _icLlmCircuitFailures } = await import("@/lib/ic/icLlmCircuitBreaker");
      _resetIcLlmCircuit();
      // Pre-seed two failures
      const { recordIcLlmFailure } = await import("@/lib/ic/icLlmCircuitBreaker");
      recordIcLlmFailure();
      recordIcLlmFailure();
      expect(_icLlmCircuitFailures()).toBe(2);

      const actorRef = {
        current: {
          translateOnChain: jest.fn().mockResolvedValue({ ok: "ICで翻訳しました。" }),
        },
      } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn();

      const result = await translateContent({
        text: "Apple announced.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(expectResult(result).backend).toBe("ic-llm");
      // Breaker counter reset on success
      expect(_icLlmCircuitFailures()).toBe(0);
    });

    it("records ic-llm failure to breaker when it fails in auto cascade", async () => {
      const { _resetIcLlmCircuit, _icLlmCircuitFailures } = await import("@/lib/ic/icLlmCircuitBreaker");
      _resetIcLlmCircuit();

      const actorRef = {
        current: {
          translateOnChain: jest.fn().mockResolvedValue({ err: "IC LLM translation failed" }),
        },
      } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn();

      await translateContent({
        text: "Apple announced.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      // Single ic-llm transport failure increments the breaker counter
      expect(_icLlmCircuitFailures()).toBe(1);
    });

    it("silently skips when cascade has ONE transport failure AND ONE validator failure", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          // Ollama transport failure (network-style)
          throw new TypeError("Load failed");
        }
        // Claude returns a meta-commentary output the validator rejects
        // with a reason that is NOT in the transport-error regex.
        return mockResponse({ translation: "Here is the translation: something English" });
      });

      const result = await translateContent({
        text: "Apple announced a new product.",
        targetLanguage: "ja",
        backend: "auto",
      });

      // Mixed transport + validator failure — silent skip (not throw).
      // Load failed × 2 (retry) fired on ollama, claude rejected by
      // validator (meta-commentary). Validator failure is in the
      // failures list, so not ALL failures are transport → silent skip.
      expect(result).toBe("skip");
    });

    it("throws diagnostic when cascade has only transport failures (no validator fails)", async () => {
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          throw new TypeError("Load failed");
        }
        // Claude also transport-fails
        return {
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: "service unavailable" }),
          text: () => Promise.resolve("service unavailable"),
        };
      });

      await expect(translateContent({
        text: "Apple announced a new product.",
        targetLanguage: "ja",
        backend: "auto",
      })).rejects.toThrow(/All 2 translation backends failed.*ollama.*claude-byok/);
    });

    it("cascade silent-skip records 'cascade exhausted (validator)' in debug log", async () => {
      const { getTranslationDebugLog, clearTranslationDebugLog } = await import("@/lib/translation/debugLog");
      clearTranslationDebugLog();
      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      // Target fr so the ja-specific no-kana promotion doesn't apply.
      // Both backends return output that blows the MAX_RATIO ceiling
      // (ratio > 5.0 for a short input) — a validator rejection with
      // reason "too long", which is NOT one of the promoted-to-skip
      // classes, AND not in TRANSPORT_ERROR_RE. The cascade must
      // exhaust all attempts and fall into the silent-skip branch.
      const shortInput = "Apple product."; // 14 chars, too short for >= 30 — wait, let me lift
      const longInput = "Apple announced a new product today at their annual keynote."; // 60 chars
      const hugeOutput = "x".repeat(longInput.length * 6); // ratio > 5.0
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: hugeOutput } }] });
        }
        return mockResponse({ translation: hugeOutput });
      });
      void shortInput;

      const result = await translateContent({
        text: longInput,
        targetLanguage: "fr",
        backend: "auto",
      });

      expect(result).toBe("skip");
      const log = getTranslationDebugLog();
      const autoSkipEntry = log.find(e => e.backend === "auto" && e.outcome === "skip");
      expect(autoSkipEntry).toBeDefined();
      expect(autoSkipEntry!.reason).toMatch(/cascade exhausted/);
      expect(autoSkipEntry!.reason).toMatch(/too long/);
    });

    it("empty-cascade silent skip records 'no configured translation backend' in debug log", async () => {
      const { getTranslationDebugLog, clearTranslationDebugLog } = await import("@/lib/translation/debugLog");
      clearTranslationDebugLog();
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockMediaPipeEnabled = false;
      mockApiKey = null;

      const result = await translateContent({
        text: "Unique text for empty cascade test " + Math.random(),
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(result).toBe("skip");
      const log = getTranslationDebugLog();
      const autoSkipEntry = log.find(e => e.backend === "auto" && e.outcome === "skip");
      expect(autoSkipEntry).toBeDefined();
      expect(autoSkipEntry!.reason).toMatch(/no configured translation backend/);
    });

    it("debug log itemHint is truncated to 60 characters", async () => {
      const { getTranslationDebugLog, clearTranslationDebugLog } = await import("@/lib/translation/debugLog");
      clearTranslationDebugLog();
      mockOllamaEnabled = true;
      mockApiKey = null;
      globalThis.fetch = jest.fn().mockImplementation(async () => mockResponse({
        choices: [{ message: { content: "アップルが新製品を発表しました。" } }],
      }));

      const longText = "This is a very long article title that should get truncated in the debug log because it exceeds the 60-character limit.";

      await translateContent({
        text: longText,
        targetLanguage: "ja",
        backend: "auto",
      });

      const log = getTranslationDebugLog();
      const entry = log.find(e => e.outcome === "ok");
      expect(entry).toBeDefined();
      expect(entry!.itemHint.length).toBeLessThanOrEqual(60);
      expect(longText.startsWith(entry!.itemHint)).toBe(true);
    });
  });

  describe("auto cascade — cache interaction", () => {
    it("returns cached translation without calling any backend", async () => {
      const { storeTranslation } = await import("@/lib/translation/cache");
      const text = "Cached auto cascade test " + Math.random();
      const cached = {
        translatedText: "キャッシュ済み翻訳",
        targetLanguage: "ja" as const,
        backend: "previously-cached",
        generatedAt: Date.now(),
      };
      await storeTranslation(text, cached);

      mockOllamaEnabled = true;
      mockApiKey = "sk-ant-test-key";
      const fetchSpy = jest.fn();
      globalThis.fetch = fetchSpy;

      const result = await translateContent({
        text,
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(result).toEqual(cached);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("integration: concurrent translateContent + semaphore + breaker", () => {
    it("4 parallel authenticated translations all succeed via ic-llm through the semaphore", async () => {
      const { _resetIcLlmCircuit, _icLlmCircuitFailures } = await import("@/lib/ic/icLlmCircuitBreaker");
      const { _icLlmInFlight, _icLlmWaiting, _resetIcLlmConcurrency } = await import("@/lib/ic/icLlmConcurrency");
      _resetIcLlmCircuit();
      _resetIcLlmConcurrency();
      mockOllamaEnabled = false;
      mockApiKey = null;

      let peakInFlight = 0;
      const actorRef = {
        current: {
          translateOnChain: jest.fn().mockImplementation(async () => {
            peakInFlight = Math.max(peakInFlight, _icLlmInFlight());
            await new Promise(r => setTimeout(r, 10));
            return { ok: "ICで翻訳しました。" };
          }),
        },
      } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn();

      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          translateContent({
            text: `Parallel item ${i}: ${Math.random()}`,
            targetLanguage: "ja",
            backend: "auto",
            actorRef,
            isAuthenticated: true,
          }),
        ),
      );

      // All four succeeded via ic-llm
      for (const r of results) {
        expect(expectResult(r).backend).toBe("ic-llm");
      }
      // Semaphore cap was respected — never more than 2 in flight
      expect(peakInFlight).toBeLessThanOrEqual(2);
      // Queue fully drained
      expect(_icLlmInFlight()).toBe(0);
      expect(_icLlmWaiting()).toBe(0);
      // Circuit breaker saw all successes — counter stays at 0
      expect(_icLlmCircuitFailures()).toBe(0);
    });

    it("breaker trips after 3 consecutive failures in parallel cascade calls", async () => {
      const { _resetIcLlmCircuit, _icLlmCircuitState } = await import("@/lib/ic/icLlmCircuitBreaker");
      const { _resetIcLlmConcurrency } = await import("@/lib/ic/icLlmConcurrency");
      _resetIcLlmCircuit();
      _resetIcLlmConcurrency();
      mockOllamaEnabled = false;
      mockApiKey = null;

      const actorRef = {
        current: {
          translateOnChain: jest.fn().mockResolvedValue({ err: "IC LLM translation failed" }),
        },
      } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn();

      // Three sequential calls (use await to keep them sequential so
      // the breaker counter increments deterministically)
      for (let i = 0; i < 3; i++) {
        const r = await translateContent({
          text: `Failing item ${i}`,
          targetLanguage: "ja",
          backend: "auto",
          actorRef,
          isAuthenticated: true,
        });
        expect(r).toBe("skip"); // transport-error on ic-llm → silent skip (cascade-exhausted)
      }

      expect(_icLlmCircuitState()).toBe("open");

      // Next call should skip ic-llm entirely (breaker open) → empty
      // cascade → silent skip
      const icSpy = actorRef.current!.translateOnChain as jest.Mock;
      icSpy.mockClear();
      const r = await translateContent({
        text: "After breaker open",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });
      expect(r).toBe("skip");
      expect(icSpy).not.toHaveBeenCalled();
      _resetIcLlmCircuit();
    });
  });

  describe("isTransientFetchError classification", () => {
    // Drive the classifier through translateWithClaude → retry path.
    it.each([
      ["Load failed", true],
      ["Failed to fetch", true],
      ["NetworkError when attempting to fetch resource", true],
      ["network request failed", true],
    ])("classifies '%s' as transient (retries once)", async (msg, _shouldRetry) => {
      mockApiKey = "sk-ant-test-key";
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) throw new Error(msg);
        return mockResponse({ translation: "アップルが発表しました。" });
      });

      await translateContent({
        text: "Apple announced a new product.",
        targetLanguage: "ja",
        backend: "cloud",
      });
      expect(callCount).toBe(2);
    });

    it("does NOT classify an error with 'aborted' in the message as transient", async () => {
      mockApiKey = "sk-ant-test-key";
      const fetchMock = jest.fn().mockRejectedValue(new Error("signal is aborted without reason"));
      globalThis.fetch = fetchMock;

      await expect(translateContent({
        text: "Apple announced.",
        targetLanguage: "ja",
        backend: "cloud",
      })).rejects.toThrow(/aborted/);
      expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
    });
  });
});
