/**
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRunScoringCascade = jest.fn();
jest.mock("@/contexts/content/scoring", () => ({
  runScoringCascade: (...args: unknown[]) => mockRunScoringCascade(...args),
}));

jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn().mockRejectedValue(new Error("no IC in test")),
}));
jest.mock("@/lib/briefing/sync", () => ({
  syncBriefingToCanister: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/offline/actionQueue", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
  dequeueAll: jest.fn().mockResolvedValue([]),
  removeAction: jest.fn().mockResolvedValue(undefined),
  incrementRetries: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: () => false }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: () => false }));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: () => null }));
jest.mock("@/lib/storage/idb", () => ({
  isIDBAvailable: () => false,
  idbGet: jest.fn().mockResolvedValue(null),
  idbPut: jest.fn().mockResolvedValue(undefined),
  STORE_CONTENT_CACHE: "content-cache",
  STORE_SCORE_CACHE: "score-cache",
}));
jest.mock("@/lib/d2a/reputation", () => ({
  recordUseful: jest.fn(),
  recordSlop: jest.fn(),
}));
jest.mock("@/lib/reputation/publishGate", () => ({
  recordPublishValidation: jest.fn(),
  recordPublishFlag: jest.fn(),
}));
jest.mock("@/lib/scoring/cache", () => ({
  computeScoringCacheKey: jest.fn().mockReturnValue("key"),
  computeProfileHash: jest.fn().mockReturnValue("hash"),
  lookupScoringCache: jest.fn().mockReturnValue(null),
  storeScoringCache: jest.fn(),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    identity: null,
    principal: null,
    principalText: "",
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

const mockAddNotification = jest.fn();
jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({
    addNotification: mockAddNotification,
  }),
}));

jest.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

import { ContentProvider, useContent } from "@/contexts/ContentContext";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ContentProvider>{children}</ContentProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe("ContentContext analyze", () => {
  it("returns scored result and adds item to content", async () => {
    mockRunScoringCascade.mockResolvedValue({
      originality: 8, insight: 7, credibility: 9, composite: 8,
      verdict: "quality", reason: "Good analysis",
      topics: ["tech"], scoringEngine: "server",
    });

    const { result } = renderHook(() => useContent(), { wrapper });

    let analyzeResult: unknown;
    await act(async () => {
      analyzeResult = await result.current.analyze("Test content for analysis");
    });

    expect(analyzeResult).toMatchObject({
      originality: 8, insight: 7, credibility: 9, composite: 8,
      verdict: "quality",
    });
    expect(result.current.content).toHaveLength(1);
    expect(result.current.content[0].text).toBe("Test content for analysis");
    expect(result.current.content[0].scores.composite).toBe(8);
  });

  it("falls back to heuristic when scoring cascade throws", async () => {
    mockRunScoringCascade.mockRejectedValue(new Error("cascade failed"));

    const { result } = renderHook(() => useContent(), { wrapper });

    let analyzeResult: Record<string, unknown> | undefined;
    await act(async () => {
      analyzeResult = await result.current.analyze("Fallback test") as unknown as Record<string, unknown>;
    });

    expect(analyzeResult).toBeDefined();
    expect(analyzeResult!.scoringEngine).toBe("heuristic");
    // Verify heuristic produces real scores, not stub values
    expect(typeof analyzeResult!.originality).toBe("number");
    expect(typeof analyzeResult!.insight).toBe("number");
    expect(typeof analyzeResult!.credibility).toBe("number");
    expect(typeof analyzeResult!.composite).toBe("number");
    expect(analyzeResult!.verdict).toMatch(/^(quality|slop)$/);
    expect(result.current.content).toHaveLength(1);
    expect(result.current.content[0].scoredByAI).toBe(false);
  });

  it("shows 'AI unavailable' notification on heuristic fallback", async () => {
    mockRunScoringCascade.mockRejectedValue(new Error("timeout"));

    const { result } = renderHook(() => useContent(), { wrapper });

    await act(async () => {
      await result.current.analyze("Notification test");
    });

    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.stringContaining("AI unavailable"),
      "info",
    );
  });

  it("sets isAnalyzing during scoring", async () => {
    let resolveScoring: (v: unknown) => void;
    mockRunScoringCascade.mockImplementation(() => new Promise(r => { resolveScoring = r; }));

    const { result } = renderHook(() => useContent(), { wrapper });

    expect(result.current.isAnalyzing).toBe(false);

    let analyzePromise: Promise<unknown>;
    act(() => {
      analyzePromise = result.current.analyze("Async test");
    });

    await waitFor(() => expect(result.current.isAnalyzing).toBe(true));

    await act(async () => {
      resolveScoring!({
        originality: 5, insight: 5, credibility: 5, composite: 5,
        verdict: "quality", reason: "ok", scoringEngine: "server",
      });
      await analyzePromise!;
    });

    expect(result.current.isAnalyzing).toBe(false);
  });

  it("builds correct ContentItem fields from result", async () => {
    mockRunScoringCascade.mockResolvedValue({
      originality: 6, insight: 7, credibility: 8, composite: 7,
      verdict: "quality", reason: "Insightful piece",
      topics: ["ai", "ml"], vSignal: 0.8, cContext: 0.6, lSlop: 0.1,
      scoringEngine: "ollama",
    });

    const { result } = renderHook(() => useContent(), { wrapper });

    await act(async () => {
      await result.current.analyze("AI analysis content", null, {
        sourceUrl: "https://example.com/article",
        imageUrl: "https://example.com/image.jpg",
      });
    });

    const item = result.current.content[0];
    expect(item.source).toBe("url");
    expect(item.sourceUrl).toBe("https://example.com/article");
    expect(item.imageUrl).toBe("https://example.com/image.jpg");
    expect(item.topics).toEqual(["ai", "ml"]);
    expect(item.vSignal).toBe(0.8);
    expect(item.scoringEngine).toBe("ollama");
    expect(item.scoredByAI).toBe(true);
    expect(item.validated).toBe(false);
    expect(item.flagged).toBe(false);
  });

  it("sets source to 'manual' when no sourceUrl", async () => {
    mockRunScoringCascade.mockResolvedValue({
      originality: 5, insight: 5, credibility: 5, composite: 5,
      verdict: "slop", reason: "Low quality", scoringEngine: "server",
    });

    const { result } = renderHook(() => useContent(), { wrapper });

    await act(async () => {
      await result.current.analyze("Manual input text");
    });

    expect(result.current.content[0].source).toBe("manual");
    expect(result.current.content[0].sourceUrl).toBeUndefined();
  });
});
