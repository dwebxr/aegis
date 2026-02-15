/**
 * @jest-environment jsdom
 */

// Polyfill AbortSignal.timeout for jsdom
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new DOMException("TimeoutError")), ms);
    return ctrl.signal;
  };
}

// Must mock fetch BEFORE importing the module
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { scoreWithOllama, testOllamaConnection, onStatusChange } from "@/lib/ollama/engine";
import { setOllamaConfig } from "@/lib/ollama/storage";
import { DEFAULT_OLLAMA_CONFIG } from "@/lib/ollama/types";

const validScoreResponse = {
  choices: [{
    message: {
      content: JSON.stringify({
        vSignal: 7, cContext: 6, lSlop: 2,
        originality: 8, insight: 7, credibility: 6,
        composite: 7.5, verdict: "quality",
        reason: "Test reason", topics: ["ai"],
      }),
    },
  }],
};

describe("ollama/engine", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    setOllamaConfig({ ...DEFAULT_OLLAMA_CONFIG, enabled: true });
  });

  describe("scoreWithOllama", () => {
    it("calls /v1/chat/completions with correct payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validScoreResponse,
      });

      const result = await scoreWithOllama("Test content", ["ai"]);
      expect(result).not.toBeNull();
      expect(result.composite).toBe(7.5);
      expect(result.verdict).toBe("quality");
      expect(result.topics).toEqual(["ai"]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:11434/v1/chat/completions");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.model).toBe("llama3.2");
      expect(body.messages[0].role).toBe("user");
      expect(body.temperature).toBe(0.3);
    });

    it("uses custom endpoint and model from config", async () => {
      setOllamaConfig({ enabled: true, endpoint: "http://custom:8080", model: "gemma2" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validScoreResponse,
      });

      await scoreWithOllama("Content");
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://custom:8080/v1/chat/completions");
      const body = JSON.parse(opts.body);
      expect(body.model).toBe("gemma2");
    });

    it("throws on non-OK HTTP response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(scoreWithOllama("Content")).rejects.toThrow("Ollama HTTP 500");
    });

    it("throws on non-JSON LLM response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "I cannot score this content." } }],
        }),
      });

      await expect(scoreWithOllama("Content")).rejects.toThrow("Failed to parse Ollama response");
    });

    it("handles fenced JSON in response", async () => {
      const fencedResponse = {
        choices: [{
          message: {
            content: "```json\n" + JSON.stringify({
              vSignal: 7, cContext: 6, lSlop: 2,
              originality: 8, insight: 7, credibility: 6,
              composite: 7.5, verdict: "quality",
              reason: "Fenced", topics: ["test"],
            }) + "\n```",
          },
        }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => fencedResponse,
      });

      const result = await scoreWithOllama("Content");
      expect(result.reason).toBe("Fenced");
    });

    it("throws when choices array is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [] }),
      });
      await expect(scoreWithOllama("Content")).rejects.toThrow("Failed to parse Ollama response");
    });

    it("throws when choices is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "unexpected format" }),
      });
      await expect(scoreWithOllama("Content")).rejects.toThrow("Failed to parse Ollama response");
    });

    it("throws when message.content is empty string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "" } }] }),
      });
      await expect(scoreWithOllama("Content")).rejects.toThrow("Failed to parse Ollama response");
    });

    it("emits loading=true then loading=false on success", async () => {
      const states: Array<{ loading: boolean }> = [];
      const unsub = onStatusChange((s) => states.push({ loading: s.loading }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validScoreResponse,
      });

      await scoreWithOllama("Content");
      unsub();

      // initial state + loading=true emit + loading=false emit
      expect(states.some(s => s.loading === true)).toBe(true);
      expect(states[states.length - 1].loading).toBe(false);
    });

    it("emits error on failure", async () => {
      const errors: Array<string | undefined> = [];
      const unsub = onStatusChange((s) => errors.push(s.error));

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      });

      await expect(scoreWithOllama("Content")).rejects.toThrow();
      unsub();

      expect(errors[errors.length - 1]).toContain("503");
    });
  });

  describe("testOllamaConnection", () => {
    it("succeeds with /api/tags (Ollama native)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "llama3.2" }, { name: "gemma2" }],
        }),
      });

      const result = await testOllamaConnection("http://localhost:11434");
      expect(result.ok).toBe(true);
      expect(result.models).toEqual(["llama3.2", "gemma2"]);
    });

    it("falls back to /v1/models when /api/tags fails", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: "model-a" }, { id: "model-b" }],
          }),
        });

      const result = await testOllamaConnection("http://localhost:11434");
      expect(result.ok).toBe(true);
      expect(result.models).toEqual(["model-a", "model-b"]);
    });

    it("returns error when both endpoints fail", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("fail1"))
        .mockRejectedValueOnce(new Error("Connection refused"));

      const result = await testOllamaConnection("http://localhost:11434");
      expect(result.ok).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.error).toBeTruthy();
    });

    it("strips trailing slashes from endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "test" }] }),
      });

      await testOllamaConnection("http://localhost:11434///");
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:11434/api/tags");
    });
  });

  describe("onStatusChange", () => {
    it("immediately fires with current status", () => {
      const listener = jest.fn();
      const unsub = onStatusChange(listener);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ connected: expect.any(Boolean) }),
      );
      unsub();
    });

    it("unsubscribe stops future updates", () => {
      const listener = jest.fn();
      const unsub = onStatusChange(listener);
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
