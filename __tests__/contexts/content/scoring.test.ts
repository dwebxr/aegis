/**
 * Tests for the scoring cascade in contexts/content/scoring.ts.
 * Mocks external services to test cascade logic — which tiers fire, how failures cascade.
 */

// Mock external dependencies before imports
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: jest.fn(() => null) }));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: jest.fn(() => false) }));
jest.mock("@/lib/mediapipe/storage", () => ({ isMediaPipeEnabled: jest.fn(() => false) }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: jest.fn(() => false) }));

const mockScoreWithMediaPipe = jest.fn();
jest.mock("@/lib/mediapipe/engine", () => ({
  scoreWithMediaPipe: (...args: unknown[]) => mockScoreWithMediaPipe(...args),
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
import { isMediaPipeEnabled } from "@/lib/mediapipe/storage";
import { isOllamaEnabled } from "@/lib/ollama/storage";
import { lookupScoringCache, storeScoringCache } from "@/lib/scoring/cache";

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

const actorRef = { current: null };

describe("runScoringCascade", () => {
  it("returns cached result when available", async () => {
    const cached = { originality: 8, insight: 7, credibility: 9, composite: 8, verdict: "quality" as const, reason: "cached", topics: [] };
    (lookupScoringCache as jest.Mock).mockReturnValueOnce(cached);

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result).toBe(cached);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls through to server Claude when no local tiers enabled", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        originality: 7, insight: 6, credibility: 8, composite: 7,
        verdict: "quality", reason: "Server scored", topics: ["tech"],
      }),
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("claude-server");
    expect(result.originality).toBe(7);
    expect(storeScoringCache).toHaveBeenCalled();
  });

  it("falls back to heuristic when server Claude fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "rate limited" }) });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("heuristic");
    expect(result.scoredByAI).toBe(false);
  });

  it("falls back to heuristic when server Claude throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("heuristic");
  });

  it("uses BYOK tier when API key is set", async () => {
    (getUserApiKey as jest.Mock).mockReturnValue("sk-test-key");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        originality: 9, insight: 8, credibility: 9, composite: 8.5,
        verdict: "quality", reason: "BYOK scored", topics: [],
        scoredByAI: true,
      }),
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("claude-byok");

    // Verify API key was sent in header
    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders["X-User-API-Key"]).toBe("sk-test-key");
  });

  it("falls through BYOK failure to server Claude", async () => {
    (getUserApiKey as jest.Mock).mockReturnValue("sk-bad-key");
    // BYOK call fails
    mockFetch
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "invalid key" }) })
      // Server call succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          originality: 6, insight: 5, credibility: 7, composite: 6,
          verdict: "quality", reason: "Server fallback", topics: [],
        }),
      });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("claude-server");
  });

  it("tries IC LLM tier when authenticated with actor", async () => {
    const mockActor = {
      analyzeOnChain: jest.fn().mockResolvedValue({
        ok: {
          originality: 8, insight: 7, credibility: 9, compositeScore: 8,
          verdict: { quality: null },
          reason: "IC analysis",
          topics: ["crypto"],
          vSignal: [7],
          cContext: [6],
          lSlop: [2],
        },
      }),
    };
    const actorRefWithActor = { current: mockActor as unknown as import("@/lib/ic/declarations")._SERVICE };

    const result = await runScoringCascade("test text", null, actorRefWithActor, true);
    expect(result.scoringEngine).toBe("claude-ic");
    expect(result.originality).toBe(8);
    expect(result.vSignal).toBe(7);
  });

  it("skips IC LLM when not authenticated", async () => {
    const mockActor = { analyzeOnChain: jest.fn() };
    const actorRefWithActor = { current: mockActor as unknown as import("@/lib/ic/declarations")._SERVICE };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ originality: 5, insight: 5, credibility: 5, composite: 5, verdict: "quality", reason: "Server", topics: [] }),
    });

    await runScoringCascade("test text", null, actorRefWithActor, false);
    expect(mockActor.analyzeOnChain).not.toHaveBeenCalled();
  });

  it("handles IC LLM error result gracefully", async () => {
    (getUserApiKey as jest.Mock).mockReturnValue(null);
    const mockActor = {
      analyzeOnChain: jest.fn().mockResolvedValue({ err: "Rate limited" }),
    };
    const actorRefWithActor = { current: mockActor as unknown as import("@/lib/ic/declarations")._SERVICE };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ originality: 5, insight: 5, credibility: 5, composite: 5, verdict: "quality", reason: "Server", topics: [] }),
    });

    const result = await runScoringCascade("test text", null, actorRefWithActor, true);
    expect(result.scoringEngine).toBe("claude-server");
  });

  it("handles IC LLM throwing error gracefully", async () => {
    (getUserApiKey as jest.Mock).mockReturnValue(null);
    const mockActor = {
      analyzeOnChain: jest.fn().mockRejectedValue(new Error("Canister trapped")),
    };
    const actorRefWithActor = { current: mockActor as unknown as import("@/lib/ic/declarations")._SERVICE };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ originality: 5, insight: 5, credibility: 5, composite: 5, verdict: "quality", reason: "Server", topics: [] }),
    });

    const result = await runScoringCascade("test text", null, actorRefWithActor, true);
    expect(result.scoringEngine).toBe("claude-server");
  });

  it("passes userContext to fetch analyze", async () => {
    const userContext = { highAffinityTopics: ["ai"], recentTopics: ["ml"] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ originality: 7, insight: 6, credibility: 7, composite: 7, verdict: "quality", reason: "Good", topics: [] }),
    });

    await runScoringCascade("text", userContext as import("@/lib/preferences/types").UserContext, actorRef, false);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.userContext).toEqual(userContext);
  });

  it("IC LLM handles empty optional arrays", async () => {
    const mockActor = {
      analyzeOnChain: jest.fn().mockResolvedValue({
        ok: {
          originality: 5, insight: 5, credibility: 5, compositeScore: 5,
          verdict: { slop: null },
          reason: "IC analysis",
          topics: [],
          vSignal: [],
          cContext: [],
          lSlop: [],
        },
      }),
    };
    const actorRefWithActor = { current: mockActor as unknown as import("@/lib/ic/declarations")._SERVICE };

    const result = await runScoringCascade("text", null, actorRefWithActor, true);
    expect(result.vSignal).toBeUndefined();
    expect(result.cContext).toBeUndefined();
    expect(result.lSlop).toBeUndefined();
    expect(result.verdict).toBe("slop");
  });

  it("caches the result after scoring", async () => {
    (getUserApiKey as jest.Mock).mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ originality: 7, insight: 6, credibility: 8, composite: 7, verdict: "quality", reason: "Scored", topics: [] }),
    });

    await runScoringCascade("text", null, actorRef, false);
    expect(storeScoringCache).toHaveBeenCalledWith("key", "hash", expect.objectContaining({ scoringEngine: "claude-server" }));
  });

  it("uses MediaPipe tier when enabled", async () => {
    (isMediaPipeEnabled as jest.Mock).mockReturnValue(true);
    mockScoreWithMediaPipe.mockResolvedValueOnce({
      vSignal: 7, cContext: 6, lSlop: 3,
      originality: 7, insight: 6, credibility: 8,
      composite: 6.5, verdict: "quality",
      reason: "MediaPipe scored", topics: ["tech"],
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("mediapipe");
    expect(result.scoredByAI).toBe(true);
    expect(result.originality).toBe(7);
  });

  it("prefers MediaPipe over WebLLM when both enabled (shared WebGPU)", async () => {
    (isMediaPipeEnabled as jest.Mock).mockReturnValue(true);
    (isWebLLMEnabled as jest.Mock).mockReturnValue(true);
    mockScoreWithMediaPipe.mockResolvedValueOnce({
      vSignal: 7, cContext: 6, lSlop: 3,
      originality: 7, insight: 6, credibility: 8,
      composite: 6.5, verdict: "quality",
      reason: "MediaPipe scored", topics: ["tech"],
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("mediapipe");
    // WebLLM engine module should not have been imported
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls through MediaPipe failure to server Claude", async () => {
    (isMediaPipeEnabled as jest.Mock).mockReturnValue(true);
    mockScoreWithMediaPipe.mockRejectedValueOnce(new Error("Array buffer allocation failed"));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        originality: 6, insight: 5, credibility: 7, composite: 6,
        verdict: "quality", reason: "Server fallback", topics: [],
      }),
    });

    const result = await runScoringCascade("test text", null, actorRef, false);
    expect(result.scoringEngine).toBe("claude-server");
  });
});
