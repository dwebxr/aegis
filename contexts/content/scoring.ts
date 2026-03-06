import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";
import { withTimeout } from "@/lib/utils/timeout";
import { getUserApiKey } from "@/lib/apiKey/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { isOllamaEnabled } from "@/lib/ollama/storage";
import { computeScoringCacheKey, computeProfileHash, lookupScoringCache, storeScoringCache } from "@/lib/scoring/cache";

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

async function tryBYOK(text: string, uc: UserContext | null | undefined, key: string): Promise<AnalyzeResponse> {
  const data = await fetchAnalyze(text, uc, key);
  if (!data) throw new Error("BYOK failed");
  return { ...data, scoringEngine: "claude-byok" as const };
}

/** Run the full scoring cascade: Ollama -> WebLLM -> BYOK -> IC LLM -> Server -> Heuristic. No side effects. */
export async function runScoringCascade(
  text: string,
  userContext: UserContext | null | undefined,
  actorRef: React.MutableRefObject<_SERVICE | null>,
  isAuthenticated: boolean,
): Promise<AnalyzeResponse> {
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
  if (isOllamaEnabled()) { localTiers.push(tryOllama(text, topics)); tierNames.push("ollama"); }
  if (isWebLLMEnabled()) { localTiers.push(tryWebLLM(text, topics)); tierNames.push("webllm"); }
  if (userApiKey) { localTiers.push(tryBYOK(text, userContext, userApiKey)); tierNames.push("byok"); }

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

  // Tier 3: IC LLM via canister (free, on-chain)
  if (!result && actorRef.current && isAuthenticated) {
    try {
      const icResult = await withTimeout(
        actorRef.current.analyzeOnChain(text.slice(0, 3000), topics),
        10_000,
        "IC LLM timeout (10s)",
      );
      if ("ok" in icResult) {
        const a = icResult.ok;
        result = {
          originality: a.originality,
          insight: a.insight,
          credibility: a.credibility,
          composite: a.compositeScore,
          verdict: "quality" in a.verdict ? "quality" : "slop",
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
    } catch (err) {
      console.warn("[scoreText] IC LLM failed:", errMsg(err));
    }
  }

  // Tier 3.5: Claude API with server key (fallback for all prior tiers)
  if (!result) {
    const data = await fetchAnalyze(text, userContext);
    if (data) {
      result = { ...data, scoringEngine: "claude-server" as const };
    } else {
      console.warn("[scoreText] Server Claude failed, falling back to heuristic");
    }
  }

  // Tier 4: Heuristic fallback
  if (!result) {
    const { heuristicScores } = await import("@/lib/ingestion/quickFilter");
    result = { ...heuristicScores(text), scoredByAI: false, scoringEngine: "heuristic" as const };
  }

  storeScoringCache(cacheKey, profileHash, result);

  return result;
}
