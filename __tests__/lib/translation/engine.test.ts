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

jest.mock("@/lib/utils/timeout", () => ({
  withTimeout: (p: Promise<unknown>) => p,
}));

import { translateContent } from "@/lib/translation/engine";
import { storeTranslation } from "@/lib/translation/cache";
import type { TranslationResult } from "@/lib/translation/types";

const origFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  mockOllamaEnabled = false;
  mockWebLLMEnabled = false;
  mockApiKey = null;
  globalThis.fetch = origFetch;
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
    const mockTranslate = jest.fn().mockResolvedValue({ ok: "IC翻訳結果" });
    const actorRef = { current: { translateOnChain: mockTranslate } } as unknown as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "ic",
      actorRef,
      isAuthenticated: true,
    });

    const r = expectResult(result);
    expect(r.translatedText).toBe("IC翻訳結果");
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

  it("returns 'failed' when response is empty", async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      return mockResponse({
        choices: [{ message: { content: "" } }],
      });
    });

    const result = await translateContent({
      text: "Hello",
      targetLanguage: "ja",
      backend: "local",
    });

    expect(result).toBe("failed");
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
          choices: [{ message: { content: "Ollama自動翻訳" } }],
        });
      });

      const result = await translateContent({
        text: "Auto test",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(expectResult(result).backend).toBe("ollama");
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
      const mockTranslate = jest.fn().mockResolvedValue({ ok: "IC自動翻訳" });
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

    it("returns null when all backends fail", async () => {
      mockOllamaEnabled = false;
      mockWebLLMEnabled = false;
      mockApiKey = null;
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("All failed"));

      const result = await translateContent({
        text: "All fail test",
        targetLanguage: "ja",
        backend: "auto",
      });

      expect(result).toBe("failed");
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
});
