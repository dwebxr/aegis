/**
 * Edge case tests for scoring cascade — covers Ollama/WebLLM tiers,
 * concurrent tier racing, and failure combinations.
 */

jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: jest.fn(() => null) }));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: jest.fn(() => false) }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: jest.fn(() => false) }));
jest.mock("@/lib/ollama/engine", () => ({
  scoreWithOllama: jest.fn(),
}));
jest.mock("@/lib/webllm/engine", () => ({
  scoreWithWebLLM: jest.fn(),
}));
jest.mock("@/lib/scoring/cache", () => ({
  computeProfileHash: jest.fn(() => "hash"),
  computeScoringCacheKey: jest.fn(() => "key"),
  lookupScoringCache: jest.fn(() => null),
  storeScoringCache: jest.fn(),
}));
jest.mock("@sentry/nextjs", () => ({
  startSpan: jest.fn((_opts: unknown, fn: () => unknown) => fn()),
  setTag: jest.fn(),
}));

const mockFetch = jest.fn();
const originalFetch = global.fetch;

import { runScoringCascade } from "@/contexts/content/scoring";
import { getUserApiKey } from "@/lib/apiKey/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { isOllamaEnabled } from "@/lib/ollama/storage";
import { scoreWithOllama } from "@/lib/ollama/engine";
import { scoreWithWebLLM } from "@/lib/webllm/engine";
import { storeScoringCache } from "@/lib/scoring/cache";

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

const actorRef = { current: null };

describe("Ollama tier", () => {
  it("uses Ollama when enabled and succeeds", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (scoreWithOllama as jest.Mock).mockResolvedValue({
      originality: 8, insight: 7, credibility: 8, composite: 7.5,
      verdict: "quality", reason: "Ollama scored", topics: ["tech"],
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("ollama");
    expect(result.scoredByAI).toBe(true);
    expect(scoreWithOllama).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled(); // No server call needed
  });

  it("falls through Ollama failure to server Claude", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (scoreWithOllama as jest.Mock).mockRejectedValue(new Error("Ollama not running"));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        originality: 6, insight: 6, credibility: 6, composite: 6,
        verdict: "quality", reason: "Server", topics: [],
      }),
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("claude-server");
  });
});

describe("WebLLM tier", () => {
  it("uses WebLLM when enabled and succeeds", async () => {
    (isWebLLMEnabled as jest.Mock).mockReturnValue(true);
    (scoreWithWebLLM as jest.Mock).mockResolvedValue({
      originality: 7, insight: 8, credibility: 7, composite: 7.3,
      verdict: "quality", reason: "WebLLM scored", topics: ["ml"],
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("webllm");
    expect(result.scoredByAI).toBe(true);
  });

  it("falls through WebLLM failure to server Claude", async () => {
    (isWebLLMEnabled as jest.Mock).mockReturnValue(true);
    (scoreWithWebLLM as jest.Mock).mockRejectedValue(new Error("Model not loaded"));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        originality: 5, insight: 5, credibility: 5, composite: 5,
        verdict: "quality", reason: "Server", topics: [],
      }),
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("claude-server");
  });
});

describe("concurrent local tiers (Promise.any)", () => {
  it("uses fastest tier when multiple enabled", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (isWebLLMEnabled as jest.Mock).mockReturnValue(true);

    // Ollama resolves fast
    (scoreWithOllama as jest.Mock).mockResolvedValue({
      originality: 9, insight: 9, credibility: 9, composite: 9,
      verdict: "quality", reason: "Ollama fast", topics: [],
    });
    // WebLLM resolves slower
    let webllmTimer: ReturnType<typeof setTimeout>;
    (scoreWithWebLLM as jest.Mock).mockImplementation(() =>
      new Promise(resolve => { webllmTimer = setTimeout(() => resolve({
        originality: 7, insight: 7, credibility: 7, composite: 7,
        verdict: "quality", reason: "WebLLM slow", topics: [],
      }), 100); }),
    );

    const result = await runScoringCascade("test text", null, actorRef, false);
    // Should use Ollama (faster)
    expect(result.scoringEngine).toBe("ollama");
    clearTimeout(webllmTimer!);
  });

  it("succeeds when one of multiple tiers fails", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (isWebLLMEnabled as jest.Mock).mockReturnValue(true);

    (scoreWithOllama as jest.Mock).mockRejectedValue(new Error("Ollama down"));
    (scoreWithWebLLM as jest.Mock).mockResolvedValue({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "WebLLM works", topics: [],
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("webllm");
  });

  it("falls to server when all local tiers + BYOK fail", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (isWebLLMEnabled as jest.Mock).mockReturnValue(true);
    (getUserApiKey as jest.Mock).mockReturnValue("sk-test");

    (scoreWithOllama as jest.Mock).mockRejectedValue(new Error("Ollama fail"));
    (scoreWithWebLLM as jest.Mock).mockRejectedValue(new Error("WebLLM fail"));
    // BYOK fails too
    mockFetch
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "key invalid" }) })
      // Server succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 5, insight: 5, credibility: 5, composite: 5,
          verdict: "quality", reason: "Server last resort", topics: [],
        }),
      });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("claude-server");
  });

  it("falls to heuristic when everything fails", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (scoreWithOllama as jest.Mock).mockRejectedValue(new Error("fail"));
    mockFetch.mockRejectedValue(new Error("all down"));

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("heuristic");
    expect(result.scoredByAI).toBe(false);
  });
});

describe("user context handling", () => {
  it("extracts topics from userContext for local tiers", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (scoreWithOllama as jest.Mock).mockResolvedValue({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "ok", topics: [],
    });

    const userContext = {
      highAffinityTopics: ["ai", "crypto"],
      recentTopics: ["defi", "nft"],
    } as import("@/lib/preferences/types").UserContext;

    await runScoringCascade("text", userContext, actorRef, false);

    // Ollama should receive topics
    const topics = (scoreWithOllama as jest.Mock).mock.calls[0][1];
    expect(topics).toContain("ai");
    expect(topics).toContain("crypto");
    expect(topics).toContain("defi");
  });

  it("limits topics to 10", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (scoreWithOllama as jest.Mock).mockResolvedValue({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "ok", topics: [],
    });

    const userContext = {
      highAffinityTopics: ["a", "b", "c", "d", "e", "f"],
      recentTopics: ["g", "h", "i", "j", "k", "l"],
    } as import("@/lib/preferences/types").UserContext;

    await runScoringCascade("text", userContext, actorRef, false);

    const topics = (scoreWithOllama as jest.Mock).mock.calls[0][1];
    expect(topics).toHaveLength(10);
  });

  it("handles null userContext gracefully", async () => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(true);
    (scoreWithOllama as jest.Mock).mockResolvedValue({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "ok", topics: [],
    });

    await runScoringCascade("text", null, actorRef, false);

    const topics = (scoreWithOllama as jest.Mock).mock.calls[0][1];
    expect(topics).toEqual([]);
  });
});

describe("caching behavior", () => {
  beforeEach(() => {
    (isOllamaEnabled as jest.Mock).mockReturnValue(false);
    (isWebLLMEnabled as jest.Mock).mockReturnValue(false);
    (getUserApiKey as jest.Mock).mockReturnValue(null);
  });

  it("stores result with correct key and hash", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        originality: 7, insight: 6, credibility: 8, composite: 7,
        verdict: "quality", reason: "test", topics: [],
      }),
    });

    await runScoringCascade("text", null, actorRef, false);

    expect(storeScoringCache).toHaveBeenCalledWith(
      "key", "hash",
      expect.objectContaining({ scoringEngine: "claude-server" }),
    );
  });

  it("stores heuristic result in cache too", async () => {
    mockFetch.mockRejectedValue(new Error("all down"));

    await runScoringCascade("text", null, actorRef, false);

    expect(storeScoringCache).toHaveBeenCalledWith(
      "key", "hash",
      expect.objectContaining({ scoringEngine: "heuristic" }),
    );
  });
});
