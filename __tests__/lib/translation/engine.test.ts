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

    it("does NOT include ic-llm in auto cascade even when authenticated", async () => {
      // Hotfix 13 removed ic-llm from the auto cascade entirely.
      // Production showed a ~42% success rate at ~8s per call, pushing
      // the per-item expected value to ~10s — worse than 3-5s of
      // going claude-server direct. IC LLM remains available via the
      // explicit `backend: "ic"` path and inside the scoring tier.
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      const icMock = jest.fn().mockResolvedValue({ ok: "IC should NOT be called" });
      const actorRef = { current: { translateOnChain: icMock } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockImplementation(async () => mockResponse({ translation: "クロードで翻訳" }));

      const result = await translateContent({
        text: "Auto should skip ic-llm",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
      });

      expect(expectResult(result).backend).toBe("claude-server");
      expect(icMock).not.toHaveBeenCalled();
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
    it("auto cascade falls through from ollama to claude-server on validator rejection", async () => {
      mockOllamaEnabled = true;
      mockApiKey = null;
      // Ollama returns English (no kana) → validator rejects → cascade
      // falls through to claude-server which returns valid Japanese.
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
      expect(r.backend).toBe("claude-server");
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
      mockApiKey = null;
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
      expect(r.backend).toBe("claude-server");
    });

    it("auto cascade throws diagnostic error when both backends fail with non-skip reasons", async () => {
      mockOllamaEnabled = true;
      mockApiKey = null;
      // Ollama rejected by validator (no kana), claude-server throws HTTP 502.
      // No smart-model no-kana promotion applies because it's a transport
      // error, not a validator rejection. Cascade exhausts and throws with
      // both names + reasons.
      globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (url.includes("11434")) {
          return mockResponse({ choices: [{ message: { content: "English without any kana" } }] });
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
      })).rejects.toThrow(/All 2 translation backends failed.*ollama.*no kana.*claude-server.*HTTP 502/);
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

    it("auto cascade promotes claude-server no-kana to 'skip' for ja target", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      // Claude server returns text without kana for a ja target —
      // e.g. the input was a URL, code block, or already-Japanese content
      // the model didn't recognize as such. Treat this as a definitive
      // "untranslatable" verdict and promote the failure to skip so the
      // retry loop doesn't keep banging on the same item every minute.
      //
      // Hotfix 13 dropped the preferredBackendTried gate because ic-llm
      // is no longer in the auto cascade — claude-server is the only
      // trusted model by construction.
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

    it("auto cascade promotes claude-server no-kana to 'skip' even with no other backends (cold-start)", async () => {
      mockOllamaEnabled = false;
      mockApiKey = null;
      // Previous cold-start gate (hotfix 5) withheld the skip promotion
      // when ic-llm was absent from the cascade, so actor-ready retry
      // could rescue items once IC was reachable. Hotfix 13 removed
      // ic-llm from the cascade entirely, so that rescue path is gone
      // and the gate was removed — no-kana from claude-server is now
      // treated as definitive on the first try.
      const actorRef = { current: null } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        return mockResponse({ translation: "Apple announced a new product." });
      });

      const result = await translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
        actorRef,
        isAuthenticated: true,
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
  });

  describe("claude-server transient fetch retry", () => {
    it("retries once when fetch throws 'Load failed' (iOS Safari transient)", async () => {
      mockApiKey = null;
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
        backend: "auto",
      });

      expect(expectResult(result).backend).toBe("claude-server");
      expect(callCount).toBe(2);
    });

    it("retries once on 'Failed to fetch' (Chrome/Edge network error)", async () => {
      mockApiKey = null;
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) throw new TypeError("Failed to fetch");
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      const result = await translateContent({
        text: "Apple announced",
        targetLanguage: "ja",
        backend: "auto",
      });
      expect(expectResult(result).backend).toBe("claude-server");
      expect(callCount).toBe(2);
    });

    it("retries once on 'NetworkError when attempting to fetch resource' (Firefox)", async () => {
      mockApiKey = null;
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) throw new Error("NetworkError when attempting to fetch resource");
        return mockResponse({ translation: "Appleが新製品を発表しました。" });
      });

      await translateContent({ text: "foo", targetLanguage: "ja", backend: "auto" });
      expect(callCount).toBe(2);
    });

    it("does NOT retry on AbortError (the timeout we explicitly wired)", async () => {
      mockApiKey = null;
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      const fetchMock = jest.fn().mockRejectedValue(abortErr);
      globalThis.fetch = fetchMock;

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
      })).rejects.toThrow(/aborted/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on HTTP 429 rate-limit (deterministic server response)", async () => {
      mockApiKey = null;
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
        backend: "auto",
      })).rejects.toThrow(/HTTP 429/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("propagates the error when BOTH attempts throw transient fetch errors", async () => {
      mockApiKey = null;
      const fetchMock = jest.fn().mockRejectedValue(new TypeError("Load failed"));
      globalThis.fetch = fetchMock;

      await expect(translateContent({
        text: "Apple announced a new product today.",
        targetLanguage: "ja",
        backend: "auto",
      })).rejects.toThrow(/Load failed/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
