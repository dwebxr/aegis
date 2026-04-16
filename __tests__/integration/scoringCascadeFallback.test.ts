/**
 * @jest-environment jsdom
 */
/**
 * Integration tests for the scoring cascade fallback transitions.
 * Each test forces one or more tiers to fail and verifies the cascade
 * lands on the expected engine. The local tiers (ollama/webllm/mediapipe/byok)
 * race via Promise.any so "first resolves wins"; IC LLM runs only if all
 * local tiers fail; server Claude runs only if IC fails; heuristic is the
 * terminal fallback.
 */
// jsdom 22 lacks TextEncoder/TextDecoder and AbortSignal.timeout — provide
// them from Node before any code under test imports (the cache hashes
// profile bytes on module load, and fetchAnalyze uses AbortSignal.timeout).
import { TextEncoder, TextDecoder } from "util";
if (typeof globalThis.TextEncoder === "undefined") {
  (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  (globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
}
if (typeof AbortSignal.timeout !== "function") {
  // Node's implementation: returns an AbortSignal that aborts after ms.
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number): AbortSignal => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(new DOMException("TimeoutError", "TimeoutError")), ms);
    if (typeof (t as unknown as { unref?: () => void }).unref === "function") {
      (t as unknown as { unref: () => void }).unref();
    }
    return ctrl.signal;
  };
}
import type { MutableRefObject } from "react";
import type { _SERVICE, OnChainAnalysis, Result } from "@/lib/ic/declarations";
import type { UserContext } from "@/lib/preferences/types";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { ScoreParseResult } from "@/lib/scoring/types";
import { runScoringCascade } from "@/contexts/content/scoring";
import { _resetScoringCache } from "@/lib/scoring/cache";
import {
  _resetIcLlmCircuit,
  _icLlmCircuitState,
  recordIcLlmFailure,
  _IC_LLM_CIRCUIT_CONSTANTS,
} from "@/lib/ic/icLlmCircuitBreaker";

jest.mock("@/lib/ollama/engine", () => ({
  scoreWithOllama: jest.fn(),
}));
jest.mock("@/lib/webllm/engine", () => ({
  scoreWithWebLLM: jest.fn(),
}));
jest.mock("@/lib/mediapipe/engine", () => ({
  scoreWithMediaPipe: jest.fn(),
}));
jest.mock("@/lib/ollama/storage", () => ({
  isOllamaEnabled: jest.fn(() => false),
}));
jest.mock("@/lib/webllm/storage", () => ({
  isWebLLMEnabled: jest.fn(() => false),
}));
jest.mock("@/lib/mediapipe/storage", () => ({
  isMediaPipeEnabled: jest.fn(() => false),
}));
jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: jest.fn(() => ""),
}));

const fetchMock = jest.fn();
global.fetch = fetchMock;

import { scoreWithOllama } from "@/lib/ollama/engine";
import { scoreWithWebLLM } from "@/lib/webllm/engine";
import { scoreWithMediaPipe } from "@/lib/mediapipe/engine";
import { isOllamaEnabled } from "@/lib/ollama/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { isMediaPipeEnabled } from "@/lib/mediapipe/storage";
import { getUserApiKey } from "@/lib/apiKey/storage";

const mocks = {
  ollama: scoreWithOllama as jest.MockedFunction<typeof scoreWithOllama>,
  webllm: scoreWithWebLLM as jest.MockedFunction<typeof scoreWithWebLLM>,
  mediapipe: scoreWithMediaPipe as jest.MockedFunction<typeof scoreWithMediaPipe>,
  isOllama: isOllamaEnabled as jest.MockedFunction<typeof isOllamaEnabled>,
  isWebLLM: isWebLLMEnabled as jest.MockedFunction<typeof isWebLLMEnabled>,
  isMediaPipe: isMediaPipeEnabled as jest.MockedFunction<typeof isMediaPipeEnabled>,
  userKey: getUserApiKey as jest.MockedFunction<typeof getUserApiKey>,
};

function baseScore(extra: Partial<AnalyzeResponse> = {}): ScoreParseResult & { scoredByAI: boolean } {
  return {
    originality: 7,
    insight: 7,
    credibility: 7,
    composite: 7,
    verdict: "quality",
    reason: "test",
    topics: [],
    vSignal: 7,
    cContext: 7,
    lSlop: 3,
    scoredByAI: true,
    ...extra,
  };
}

function makeActorRef(
  analyzeOnChain?: (text: string, topics: string[]) => Promise<Result<OnChainAnalysis, string>>,
): MutableRefObject<_SERVICE | null> {
  if (!analyzeOnChain) return { current: null };
  return {
    current: { analyzeOnChain } as unknown as _SERVICE,
  };
}

function icOk(a: Partial<OnChainAnalysis> = {}): Result<OnChainAnalysis, string> {
  return {
    ok: {
      originality: 8,
      insight: 7,
      credibility: 8,
      compositeScore: 7.7,
      verdict: { quality: null },
      reason: "ic ok",
      topics: [],
      vSignal: [],
      cContext: [],
      lSlop: [],
      ...a,
    } as OnChainAnalysis,
  };
}

const TEXT = "The benchmark shows 40% improvement with 95% confidence per the MIT paper at https://example.com/paper.";
const USER_CONTEXT: UserContext = {
  highAffinityTopics: ["ai"],
  lowAffinityTopics: [],
  trustedAuthors: [],
  recentTopics: ["research"],
};

beforeEach(() => {
  _resetScoringCache();
  _resetIcLlmCircuit();
  localStorage.clear();
  fetchMock.mockReset();
  mocks.ollama.mockReset();
  mocks.webllm.mockReset();
  mocks.mediapipe.mockReset();
  mocks.isOllama.mockReturnValue(false);
  mocks.isWebLLM.mockReturnValue(false);
  mocks.isMediaPipe.mockReturnValue(false);
  mocks.userKey.mockReturnValue("");
});

describe("Scoring cascade — tier fallback transitions", () => {
  it("all tiers off → heuristic is the terminal fallback", async () => {
    const result = await runScoringCascade(TEXT, null, makeActorRef(), false);
    expect(result.scoringEngine).toBe("heuristic");
    expect(result.scoredByAI).toBe(false);
  });

  it("ollama enabled + succeeds → returns ollama result", async () => {
    mocks.isOllama.mockReturnValue(true);
    mocks.ollama.mockResolvedValue(baseScore({ reason: "ollama says ok" }));
    const result = await runScoringCascade(TEXT, USER_CONTEXT, makeActorRef(), false);
    expect(result.scoringEngine).toBe("ollama");
    expect(result.reason).toBe("ollama says ok");
  });

  it("ollama enabled + fails + no other local tiers → server claude", async () => {
    mocks.isOllama.mockReturnValue(true);
    mocks.ollama.mockRejectedValue(new Error("ollama connection refused"));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => baseScore({ reason: "server ok" }),
    });
    const result = await runScoringCascade(TEXT, USER_CONTEXT, makeActorRef(), false);
    expect(result.scoringEngine).toBe("claude-server");
  });

  it("webllm enabled + fails + ic unauthenticated + server fails → heuristic", async () => {
    mocks.isWebLLM.mockReturnValue(true);
    mocks.webllm.mockRejectedValue(new Error("webgpu unavailable"));
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "server down" }),
    });
    const result = await runScoringCascade(TEXT, null, makeActorRef(), false);
    expect(result.scoringEngine).toBe("heuristic");
  });

  it("mediapipe wins over webllm when both enabled (mediapipe preferred)", async () => {
    mocks.isMediaPipe.mockReturnValue(true);
    mocks.isWebLLM.mockReturnValue(true);
    mocks.mediapipe.mockResolvedValue(baseScore({ reason: "mediapipe" }));
    mocks.webllm.mockResolvedValue(baseScore({ reason: "webllm" }));
    const result = await runScoringCascade(TEXT, null, makeActorRef(), false);
    expect(result.scoringEngine).toBe("mediapipe");
    expect(mocks.webllm).not.toHaveBeenCalled();
  });

  it("byok key present + fails + IC authenticated → IC LLM tier", async () => {
    mocks.userKey.mockReturnValue("sk-ant-test-key");
    fetchMock.mockImplementation(async (url: string) => {
      // BYOK uses /api/analyze with X-User-API-Key header and returns non-ok
      if (url.includes("/api/analyze")) {
        return { ok: false, status: 500, json: async () => ({ error: "byok upstream" }) };
      }
      throw new Error("unexpected fetch url");
    });
    const ic = jest.fn(() => Promise.resolve(icOk({ reason: "ic served" })));
    const result = await runScoringCascade(TEXT, null, makeActorRef(ic), true);
    expect(result.scoringEngine).toBe("claude-ic");
    expect(result.reason).toBe("ic served");
    expect(ic).toHaveBeenCalledTimes(1);
  });

  it("IC circuit open → skips IC tier, goes straight to server claude", async () => {
    for (let i = 0; i < _IC_LLM_CIRCUIT_CONSTANTS.FAILURE_THRESHOLD; i++) recordIcLlmFailure();
    expect(_icLlmCircuitState()).toBe("open");

    const ic = jest.fn(() => Promise.resolve(icOk()));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => baseScore({ reason: "server" }),
    });
    const result = await runScoringCascade(TEXT, null, makeActorRef(ic), true);
    expect(ic).not.toHaveBeenCalled();
    expect(result.scoringEngine).toBe("claude-server");
  });

  it("IC LLM returns err result + server fails → heuristic", async () => {
    const ic = jest.fn(() => Promise.resolve<Result<OnChainAnalysis, string>>({ err: "rate limited" }));
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "server dead" }),
    });
    const result = await runScoringCascade(TEXT, null, makeActorRef(ic), true);
    expect(ic).toHaveBeenCalled();
    expect(result.scoringEngine).toBe("heuristic");
  });

  it("IC LLM throws transport error → records failure + falls back to server", async () => {
    const ic = jest.fn(() => Promise.reject(new Error("canister unreachable")));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => baseScore({ reason: "server-recover" }),
    });
    const result = await runScoringCascade(TEXT, null, makeActorRef(ic), true);
    expect(ic).toHaveBeenCalled();
    expect(result.scoringEngine).toBe("claude-server");
  });

  it("IC unauthenticated → skipped, server claude serves", async () => {
    const ic = jest.fn(() => Promise.resolve(icOk()));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => baseScore({ reason: "server" }),
    });
    const result = await runScoringCascade(TEXT, null, makeActorRef(ic), false);
    expect(ic).not.toHaveBeenCalled();
    expect(result.scoringEngine).toBe("claude-server");
  });

  it("server Claude fetch network error → heuristic", async () => {
    fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));
    const result = await runScoringCascade(TEXT, null, makeActorRef(), false);
    expect(result.scoringEngine).toBe("heuristic");
  });

  it("all local tiers fail simultaneously + IC err + server err → heuristic", async () => {
    mocks.isOllama.mockReturnValue(true);
    mocks.isMediaPipe.mockReturnValue(true);
    mocks.userKey.mockReturnValue("sk-ant-test-key");
    mocks.ollama.mockRejectedValue(new Error("ollama down"));
    mocks.mediapipe.mockRejectedValue(new Error("webgpu init failed"));
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "all down" }) });
    const ic = jest.fn(() => Promise.resolve<Result<OnChainAnalysis, string>>({ err: "rate limit" }));
    const result = await runScoringCascade(TEXT, null, makeActorRef(ic), true);
    expect(result.scoringEngine).toBe("heuristic");
  });

  it("cache hit short-circuits the entire cascade", async () => {
    mocks.isOllama.mockReturnValue(true);
    mocks.ollama.mockResolvedValue(baseScore({ reason: "first call" }));
    const first = await runScoringCascade(TEXT, USER_CONTEXT, makeActorRef(), false);
    expect(first.reason).toBe("first call");
    expect(mocks.ollama).toHaveBeenCalledTimes(1);

    // Second call with identical text+context should hit cache.
    mocks.ollama.mockClear();
    const second = await runScoringCascade(TEXT, USER_CONTEXT, makeActorRef(), false);
    expect(second.reason).toBe("first call");
    expect(mocks.ollama).not.toHaveBeenCalled();
  });

  it("different userContext → different cache key → cascade re-runs", async () => {
    mocks.isOllama.mockReturnValue(true);
    mocks.ollama.mockResolvedValueOnce(baseScore({ reason: "ctx-a" }));
    mocks.ollama.mockResolvedValueOnce(baseScore({ reason: "ctx-b" }));

    const ctxA: UserContext = { highAffinityTopics: ["ai"], lowAffinityTopics: [], trustedAuthors: [], recentTopics: [] };
    const ctxB: UserContext = { highAffinityTopics: ["crypto"], lowAffinityTopics: [], trustedAuthors: [], recentTopics: [] };

    const r1 = await runScoringCascade(TEXT, ctxA, makeActorRef(), false);
    const r2 = await runScoringCascade(TEXT, ctxB, makeActorRef(), false);
    expect(r1.reason).toBe("ctx-a");
    expect(r2.reason).toBe("ctx-b");
    expect(mocks.ollama).toHaveBeenCalledTimes(2);
  });
});
