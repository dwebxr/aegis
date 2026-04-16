import * as Sentry from "@sentry/nextjs";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { Verdict } from "@/lib/types/content";
import type { UserContext } from "@/lib/preferences/types";
import type { _SERVICE, OnChainAnalysis, Result } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";
import { withTimeout } from "@/lib/utils/timeout";
import { getUserApiKey } from "@/lib/apiKey/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { isMediaPipeEnabled } from "@/lib/mediapipe/storage";
import { isOllamaEnabled } from "@/lib/ollama/storage";
import { computeScoringCacheKey, computeProfileHash, lookupScoringCache, storeScoringCache } from "@/lib/scoring/cache";
import { withIcLlmSlot } from "@/lib/ic/icLlmConcurrency";
import {
  isIcLlmCircuitOpen,
  recordIcLlmSuccess,
  recordIcLlmFailure,
} from "@/lib/ic/icLlmCircuitBreaker";

async function fetchAnalyze(
  text: string,
  userContext?: UserContext | null,
  apiKey?: string,
): Promise<AnalyzeResponse | null> {
  try {
    const body: Record<string, unknown> = { text };
    if (userContext) body.userContext = userContext;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["X-User-API-Key"] = apiKey;
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn("[analyze] API returned", res.status, data?.error || "");
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[analyze] fetch failed:", errMsg(err));
    return null;
  }
}

async function tryOllama(text: string, topics: string[]): Promise<AnalyzeResponse> {
  const { scoreWithOllama } = await import("@/lib/ollama/engine");
  const r = await scoreWithOllama(text, topics);
  return { ...r, scoredByAI: true, scoringEngine: "ollama" as const };
}

async function tryWebLLM(text: string, topics: string[]): Promise<AnalyzeResponse> {
  const { scoreWithWebLLM } = await import("@/lib/webllm/engine");
  const r = await scoreWithWebLLM(text, topics);
  return { ...r, scoredByAI: true, scoringEngine: "webllm" as const };
}

async function tryMediaPipe(text: string, topics: string[]): Promise<AnalyzeResponse> {
  const { scoreWithMediaPipe } = await import("@/lib/mediapipe/engine");
  const r = await scoreWithMediaPipe(text, topics);
  return { ...r, scoredByAI: true, scoringEngine: "mediapipe" as const };
}

async function tryBYOK(text: string, uc: UserContext | null | undefined, key: string): Promise<AnalyzeResponse> {
  const data = await fetchAnalyze(text, uc, key);
  if (!data) throw new Error("BYOK failed");
  return { ...data, scoringEngine: "claude-byok" as const };
}

export async function runScoringCascade(
  text: string,
  userContext: UserContext | null | undefined,
  actorRef: React.MutableRefObject<_SERVICE | null>,
  isAuthenticated: boolean,
): Promise<AnalyzeResponse> {
  return Sentry.startSpan({ name: "scoring.cascade", op: "scoring" }, async () => {
    const profileHash = computeProfileHash(userContext);
    const cacheKey = computeScoringCacheKey(text, userContext, profileHash);
    const cached = lookupScoringCache(cacheKey, profileHash);
    if (cached) return cached;

    let result: AnalyzeResponse | null = null;
    const userApiKey = getUserApiKey();
    const topics = userContext
      ? [...(userContext.highAffinityTopics || []), ...(userContext.recentTopics || [])].slice(0, 10)
      : [];

    // Tier 0-2: Run enabled local tiers in parallel (fastest wins)
    const localTiers: Promise<AnalyzeResponse>[] = [];
    const tierNames: string[] = [];
    if (isOllamaEnabled()) {
      localTiers.push(Sentry.startSpan({ name: "scoring.ollama", op: "scoring.tier" }, () => tryOllama(text, topics)));
      tierNames.push("ollama");
    }
    // WebLLM and MediaPipe share WebGPU — use one, not both
    if (isMediaPipeEnabled()) {
      localTiers.push(Sentry.startSpan({ name: "scoring.mediapipe", op: "scoring.tier" }, () => tryMediaPipe(text, topics)));
      tierNames.push("mediapipe");
    } else if (isWebLLMEnabled()) {
      localTiers.push(Sentry.startSpan({ name: "scoring.webllm", op: "scoring.tier" }, () => tryWebLLM(text, topics)));
      tierNames.push("webllm");
    }
    if (userApiKey) {
      localTiers.push(Sentry.startSpan({ name: "scoring.byok", op: "scoring.tier" }, () => tryBYOK(text, userContext, userApiKey)));
      tierNames.push("byok");
    }

    if (localTiers.length > 0) {
      try {
        result = await Promise.any(localTiers);
      } catch (err) {
        const reasons = err instanceof AggregateError
          ? err.errors.map((e, i) => `${tierNames[i]}: ${errMsg(e)}`).join("; ")
          : errMsg(err);
        console.warn("[scoreText] All local tiers failed:", reasons);
      }
    }

    // Tier 3: IC LLM via canister (free, on-chain). The withIcLlmSlot
    // wrapper enforces the 2-concurrent ceiling shared with translateOnChain
    // — see lib/ic/icLlmConcurrency.ts. Without it, scoring + translation
    // running in parallel would push the LLM canister past its per-caller
    // limit and items would fail with "IC LLM translation failed".
    //
    // The circuit breaker (lib/ic/icLlmCircuitBreaker.ts) tracks
    // consecutive transport-level failures across BOTH analyze and
    // translate. When it is open we skip this tier entirely and fall
    // through to the server Claude tier — no point burning 10s on a
    // call we know will fail.
    if (!result && actorRef.current && isAuthenticated && !isIcLlmCircuitOpen()) {
      try {
        result = await Sentry.startSpan({ name: "scoring.ic-llm", op: "scoring.tier" }, async () => {
          let icResult: Result<OnChainAnalysis, string>;
          try {
            icResult = await withIcLlmSlot(() => withTimeout(
              actorRef.current!.analyzeOnChain(text.slice(0, 3000), topics),
              10_000,
              "IC LLM timeout (10s)",
            ));
          } catch (err) {
            recordIcLlmFailure();
            throw err;
          }
          if ("err" in icResult) {
            recordIcLlmFailure();
          } else {
            recordIcLlmSuccess();
          }
          if ("ok" in icResult) {
            const a = icResult.ok;
            return {
              originality: a.originality,
              insight: a.insight,
              credibility: a.credibility,
              composite: a.compositeScore,
              verdict: ("quality" in a.verdict ? "quality" : "slop") as Verdict,
              reason: a.reason,
              topics: a.topics,
              vSignal: a.vSignal.length > 0 ? a.vSignal[0] : undefined,
              cContext: a.cContext.length > 0 ? a.cContext[0] : undefined,
              lSlop: a.lSlop.length > 0 ? a.lSlop[0] : undefined,
              scoringEngine: "claude-ic" as const,
            };
          } else if ("err" in icResult) {
            console.warn("[scoreText] IC LLM error:", icResult.err);
          }
          return null;
        });
      } catch (err) {
        console.warn("[scoreText] IC LLM failed:", errMsg(err));
      }
    }

    // Tier 3.5: Claude API with server key (fallback for all prior tiers)
    if (!result) {
      result = await Sentry.startSpan({ name: "scoring.server-claude", op: "scoring.tier" }, async () => {
        const data = await fetchAnalyze(text, userContext);
        if (data) return { ...data, scoringEngine: "claude-server" as const };
        console.warn("[scoreText] Server Claude failed, falling back to heuristic");
        return null;
      });
    }

    // Tier 4: Heuristic fallback
    if (!result) {
      const { heuristicScores } = await import("@/lib/ingestion/quickFilter");
      result = { ...heuristicScores(text), scoredByAI: false, scoringEngine: "heuristic" as const };
    }

    Sentry.setTag("scoring.engine", result.scoringEngine ?? "unknown");
    storeScoringCache(cacheKey, profileHash, result);

    return result;
  });
}
