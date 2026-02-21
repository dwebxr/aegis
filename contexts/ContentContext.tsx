"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { relativeTime } from "@/lib/utils/scores";
import { useNotify } from "./NotificationContext";
import type { ContentItem } from "@/lib/types/content";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import { getUserApiKey } from "@/lib/apiKey/storage";
import type { _SERVICE, ContentSource } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";
import { withTimeout } from "@/lib/utils/timeout";
import { recordUseful, recordSlop } from "@/lib/d2a/reputation";
import { recordPublishValidation, recordPublishFlag } from "@/lib/reputation/publishGate";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { isOllamaEnabled } from "@/lib/ollama/storage";
import { encodeEngineInReason, decodeEngineFromReason, encodeTopicsInReason, decodeTopicsFromReason } from "@/lib/scoring/types";
import { syncBriefingToCanister } from "@/lib/briefing/sync";
import type { BriefingState } from "@/lib/briefing/types";

const CONTENT_CACHE_KEY = "aegis-content-cache";
const MAX_CACHED_ITEMS = 200;

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
      signal: AbortSignal.timeout(30_000),
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

function loadCachedContent(): ContentItem[] {
  if (typeof globalThis.localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONTENT_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: unknown): c is ContentItem =>
        !!c && typeof c === "object" &&
        typeof (c as ContentItem).id === "string" &&
        typeof (c as ContentItem).createdAt === "number",
    );
  } catch {
    return [];
  }
}

function saveCachedContent(items: ContentItem[]): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(truncatePreservingActioned(items)));
  } catch {
    // localStorage full — ignore
  }
}

/** Truncate to MAX_CACHED_ITEMS but never drop validated or flagged items. */
function truncatePreservingActioned(items: ContentItem[]): ContentItem[] {
  if (items.length <= MAX_CACHED_ITEMS) return items;

  const actioned: ContentItem[] = [];
  const unactioned: ContentItem[] = [];
  for (const item of items) {
    if (item.validated || item.flagged) {
      actioned.push(item);
    } else {
      unactioned.push(item);
    }
  }

  const unactionedBudget = Math.max(0, MAX_CACHED_ITEMS - actioned.length);
  const trimmedUnactioned = unactioned.slice(0, unactionedBudget);

  // Preserve original order (newest-first)
  const preservedIds = new Set([
    ...actioned.map(c => c.id),
    ...trimmedUnactioned.map(c => c.id),
  ]);
  return items.filter(c => preservedIds.has(c.id));
}

interface ContentState {
  content: ContentItem[];
  isAnalyzing: boolean;
  syncStatus: "idle" | "syncing" | "synced" | "offline";
  analyze: (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }) => Promise<AnalyzeResponse>;
  /** Run the full scoring cascade without side effects (no state update, no IC save). Used by scheduler. */
  scoreText: (text: string, userContext?: UserContext | null) => Promise<AnalyzeResponse>;
  validateItem: (id: string) => void;
  flagItem: (id: string) => void;
  addContent: (item: ContentItem) => void;
  clearDemoContent: () => void;
  loadFromIC: () => Promise<void>;
  syncBriefing: (state: BriefingState, nostrPubkey?: string | null) => void;
}

type PreferenceCallbacks = {
  onValidate?: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
  onFlag?: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
};

const defaultAnalyzeResponse: AnalyzeResponse = { originality: 0, insight: 0, credibility: 0, composite: 0, verdict: "slop" as const, reason: "" };

const ContentContext = createContext<ContentState>({
  content: [],
  isAnalyzing: false,
  syncStatus: "idle",
  analyze: async () => defaultAnalyzeResponse,
  scoreText: async () => defaultAnalyzeResponse,
  validateItem: () => {},
  flagItem: () => {},
  addContent: () => {},
  clearDemoContent: () => {},
  loadFromIC: async () => {},
  syncBriefing: () => {},
});

const SOURCE_KEYS = ["rss", "url", "twitter", "nostr", "manual"] as const;

function mapSource(s: string): ContentSource {
  const key = SOURCE_KEYS.includes(s as typeof SOURCE_KEYS[number]) ? s : "manual";
  return { [key]: null } as ContentSource;
}

function mapSourceBack(s: ContentSource): string {
  return SOURCE_KEYS.find(k => k in s) || "manual";
}

function toICEvaluation(c: ContentItem, owner: import("@dfinity/principal").Principal) {
  return {
    id: c.id,
    owner,
    author: c.author,
    avatar: c.avatar,
    text: c.text,
    source: mapSource(c.source),
    sourceUrl: c.sourceUrl ? [c.sourceUrl] as [string] : [] as [],
    imageUrl: c.imageUrl ? [c.imageUrl] as [string] : [] as [],
    scores: {
      originality: Math.round(c.scores.originality),
      insight: Math.round(c.scores.insight),
      credibility: Math.round(c.scores.credibility),
      compositeScore: c.scores.composite,
    },
    verdict: c.verdict === "quality" ? { quality: null } : { slop: null },
    reason: encodeTopicsInReason(
      c.scoringEngine ? encodeEngineInReason(c.scoringEngine, c.reason) : c.reason,
      c.topics,
    ),
    createdAt: BigInt(c.createdAt * 1_000_000),
    validated: c.validated,
    flagged: c.flagged,
    validatedAt: c.validatedAt ? [BigInt(c.validatedAt * 1_000_000)] as [bigint] : [] as [],
  };
}

export function ContentProvider({ children, preferenceCallbacks }: { children: React.ReactNode; preferenceCallbacks?: PreferenceCallbacks }) {
  const { addNotification } = useNotify();
  const { isAuthenticated, identity, principal } = useAuth();
  const [content, setContent] = useState<ContentItem[]>(() => loadCachedContent());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "offline">("idle");
  const actorRef = useRef<_SERVICE | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const loadFromICRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (isAuthenticated && identity) {
      createBackendActorAsync(identity)
        .then(actor => {
          actorRef.current = actor;
          setSyncStatus("idle");
          // Actor is now ready — auto-load IC data
          loadFromICRef.current().catch((err: unknown) => {
            console.warn("[content] Auto-loadFromIC after actor creation failed:", errMsg(err));
          });
        })
        .catch((err: unknown) => {
          console.error("[content] Failed to create IC actor:", errMsg(err));
          actorRef.current = null;
          setSyncStatus("offline");
          addNotification("Could not connect to IC — content won't sync", "error");
        });
    } else {
      actorRef.current = null;
      setSyncStatus("offline");
    }
  }, [isAuthenticated, identity, addNotification]);

  useEffect(() => {
    saveCachedContent(content);
  }, [content]);

  useEffect(() => {
    const updateTimestamps = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      setContent(prev => {
        let changed = false;
        const next = prev.map(c => {
          const ts = relativeTime(c.createdAt);
          if (ts !== c.timestamp) {
            changed = true;
            return { ...c, timestamp: ts };
          }
          return c;
        });
        return changed ? next : prev;
      });
    };
    const timestampTimer = setInterval(updateTimestamps, 30000);
    const onVisible = () => { if (!document.hidden) updateTimestamps(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timestampTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /** Run the full scoring cascade: Ollama → WebLLM → BYOK → IC LLM → Server → Heuristic. No side effects. */
  const scoreText = useCallback(async (text: string, userContext?: UserContext | null): Promise<AnalyzeResponse> => {
    let result: AnalyzeResponse | null = null;
    const userApiKey = getUserApiKey();
    const topics = userContext
      ? [...(userContext.highAffinityTopics || []), ...(userContext.recentTopics || [])].slice(0, 10)
      : [];

    // Tier 0: Ollama (local LLM server)
    if (isOllamaEnabled()) {
      try {
        const { scoreWithOllama } = await import("@/lib/ollama/engine");
        const ollamaResult = await scoreWithOllama(text, topics);
        result = { ...ollamaResult, scoredByAI: true, scoringEngine: "ollama" as const };
      } catch (err) {
        console.warn("[scoreText] Ollama failed, falling back:", errMsg(err));
      }
    }

    // Tier 1: WebLLM (browser-local AI)
    if (!result && isWebLLMEnabled()) {
      try {
        const { scoreWithWebLLM } = await import("@/lib/webllm/engine");
        const webllmResult = await scoreWithWebLLM(text, topics);
        result = { ...webllmResult, scoredByAI: true, scoringEngine: "webllm" as const };
      } catch (err) {
        console.warn("[scoreText] WebLLM failed, falling back:", errMsg(err));
      }
    }

    // Tier 2: Claude API with user's own key (BYOK)
    if (!result && userApiKey) {
      const data = await fetchAnalyze(text, userContext, userApiKey);
      if (data) {
        result = { ...data, scoringEngine: "claude-byok" as const };
      } else {
        console.warn("[scoreText] BYOK failed, falling back to IC LLM");
      }
    }

    // Tier 3: IC LLM via canister (free, on-chain)
    if (!result && actorRef.current && isAuthenticated) {
      try {
        const icResult = await withTimeout(
          actorRef.current.analyzeOnChain(text.slice(0, 3000), topics),
          30_000,
          "IC LLM timeout (30s)",
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

    // Tier 3.5: Claude API with server key
    if (!result && !userApiKey) {
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

    return result;
  }, [isAuthenticated]);

  const analyze = useCallback(async (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }): Promise<AnalyzeResponse> => {
    setIsAnalyzing(true);
    try {
      const result = await scoreText(text, userContext);

      const evaluation: ContentItem = {
        id: uuidv4(),
        owner: principal ? principal.toText() : "",
        author: "You",
        avatar: "\u{1F50D}",
        text: text.slice(0, 300),
        source: meta?.sourceUrl ? "url" : "manual",
        sourceUrl: meta?.sourceUrl,
        imageUrl: meta?.imageUrl,
        scores: {
          originality: result.originality,
          insight: result.insight,
          credibility: result.credibility,
          composite: result.composite,
        },
        verdict: result.verdict,
        reason: result.reason,
        createdAt: Date.now(),
        validated: false,
        flagged: false,
        timestamp: "just now",
        topics: result.topics,
        vSignal: result.vSignal,
        cContext: result.cContext,
        lSlop: result.lSlop,
        scoredByAI: result.scoringEngine !== "heuristic",
        scoringEngine: result.scoringEngine,
      };
      setContent(prev => truncatePreservingActioned([evaluation, ...prev]));

      if (actorRef.current && isAuthenticated && principal) {
        void actorRef.current.saveEvaluation(toICEvaluation(evaluation, principal)).catch((err: unknown) => {
          console.warn("[content] IC saveEvaluation failed:", errMsg(err));
          setSyncStatus("offline");
          addNotification("Evaluation saved locally but IC sync failed", "error");
        });
      }

      return result;
    } finally { setIsAnalyzing(false); }
  }, [scoreText, isAuthenticated, principal, addNotification]);

  const validateItem = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    if (!item || item.validated) return;
    setContent(prev => prev.map(c => c.id === id ? { ...c, validated: true, validatedAt: c.validatedAt ?? Date.now() } : c));
    preferenceCallbacks?.onValidate?.(item.topics || [], item.author, item.scores.composite, item.verdict);
    if (item.source === "nostr" && item.nostrPubkey) recordUseful(item.nostrPubkey);
    if (item.source === "manual" && item.nostrPubkey) recordPublishValidation(item.nostrPubkey);
    if (actorRef.current && isAuthenticated) {
      void actorRef.current.updateEvaluation(id, true, item.flagged)
        .catch((err: unknown) => {
          console.warn("[content] IC updateEvaluation (validate) failed:", errMsg(err));
          setSyncStatus("offline");
          addNotification("Validation saved locally but IC sync failed", "error");
        });
    }
  }, [isAuthenticated, preferenceCallbacks, addNotification]);

  const flagItem = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    if (!item || item.flagged) return;
    setContent(prev => prev.map(c => c.id === id ? { ...c, flagged: true } : c));
    preferenceCallbacks?.onFlag?.(item.topics || [], item.author, item.scores.composite, item.verdict);
    if (item.source === "nostr" && item.nostrPubkey) recordSlop(item.nostrPubkey);
    if (item.source === "manual" && item.nostrPubkey) recordPublishFlag(item.nostrPubkey);
    if (actorRef.current && isAuthenticated) {
      void actorRef.current.updateEvaluation(id, item.validated, true)
        .catch((err: unknown) => {
          console.warn("[content] IC updateEvaluation (flag) failed:", errMsg(err));
          setSyncStatus("offline");
          addNotification("Flag saved locally but IC sync failed", "error");
        });
    }
  }, [isAuthenticated, preferenceCallbacks, addNotification]);

  const addContent = useCallback((item: ContentItem) => {
    const isDuplicate = contentRef.current.some(c =>
      (item.sourceUrl && c.sourceUrl === item.sourceUrl) ||
      (!item.sourceUrl && c.text === item.text),
    );
    if (isDuplicate) return;

    const owned = (!item.owner && isAuthenticated && principal)
      ? { ...item, owner: principal.toText() }
      : item;

    setContent(prev => truncatePreservingActioned([owned, ...prev]));
    if (actorRef.current && isAuthenticated && principal) {
      void actorRef.current.saveEvaluation(toICEvaluation(owned, principal)).catch((err: unknown) => {
        console.warn("[content] IC save (addContent) failed:", errMsg(err));
        setSyncStatus("offline");
        addNotification("Content saved locally but IC sync failed", "error");
      });
    }
  }, [isAuthenticated, principal, addNotification]);

  const clearDemoContent = useCallback(() => {
    setContent(prev => prev.filter(c => c.owner !== ""));
  }, []);

  const backfillImageUrls = useCallback(() => {
    const items = contentRef.current
      .filter(c => c.sourceUrl && !c.imageUrl && /^https?:\/\//i.test(c.sourceUrl))
      .slice(0, 10);
    if (items.length === 0) return;

    // Stagger requests to avoid rate limiting
    items.forEach((item, i) => {
      setTimeout(async () => {
        try {
          const res = await fetch("/api/fetch/ogimage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: item.sourceUrl }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const data = await res.json();
          if (!data.imageUrl) return;
          setContent(prev => prev.map(c =>
            c.id === item.id && !c.imageUrl ? { ...c, imageUrl: data.imageUrl } : c,
          ));
          // Persist to IC if authenticated
          if (actorRef.current && isAuthenticated) {
            const updated = contentRef.current.find(c => c.id === item.id);
            if (updated && principal) {
              void actorRef.current.saveEvaluation(toICEvaluation({ ...updated, imageUrl: data.imageUrl }, principal)).catch(() => {});
            }
          }
        } catch {
          // Silently ignore backfill failures
        }
      }, i * 1500);
    });
  }, [isAuthenticated, principal]);

  const loadFromIC = useCallback(async () => {
    if (!actorRef.current || !isAuthenticated || !principal) return;
    setSyncStatus("syncing");

    try {
      const PAGE_SIZE = BigInt(100);
      const allEvals: Awaited<ReturnType<_SERVICE["getUserEvaluations"]>> = [];
      let offset = BigInt(0);
      for (;;) {
        const page = await actorRef.current.getUserEvaluations(principal, offset, PAGE_SIZE);
        allEvals.push(...page);
        if (BigInt(page.length) < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      const loaded: ContentItem[] = allEvals.map(e => {
        const { engine, cleanReason: reasonWithTopics } = decodeEngineFromReason(e.reason);
        const { topics, cleanReason } = decodeTopicsFromReason(reasonWithTopics);
        return {
          id: e.id,
          owner: e.owner.toText(),
          author: e.author,
          avatar: e.avatar,
          text: e.text,
          source: mapSourceBack(e.source) as ContentItem["source"],
          sourceUrl: e.sourceUrl.length > 0 ? e.sourceUrl[0] : undefined,
          imageUrl: e.imageUrl?.length ? e.imageUrl[0] : undefined,
          scores: {
            originality: e.scores.originality,
            insight: e.scores.insight,
            credibility: e.scores.credibility,
            composite: e.scores.compositeScore,
          },
          verdict: ("quality" in e.verdict ? "quality" : "slop") as ContentItem["verdict"],
          reason: cleanReason,
          topics: topics.length > 0 ? topics : undefined,
          createdAt: Number(e.createdAt) / 1_000_000,
          validated: e.validated,
          flagged: e.flagged,
          validatedAt: e.validatedAt.length > 0 ? Number(e.validatedAt[0]) / 1_000_000 : undefined,
          timestamp: relativeTime(Number(e.createdAt) / 1_000_000),
          scoredByAI: engine ? engine !== "heuristic" : !e.reason.startsWith("Heuristic"),
          scoringEngine: engine,
        };
      });

      if (loaded.length > 0) {
        setContent(prev => {
          // Build lookup from cached items to preserve fields not stored in IC (topics, vSignal, etc.)
          const cachedById = new Map(prev.map(c => [c.id, c]));
          const merged = loaded.map(l => {
            const cached = cachedById.get(l.id);
            if (!cached) return l;
            return {
              ...l,
              topics: l.topics ?? cached.topics,
              vSignal: l.vSignal ?? cached.vSignal,
              cContext: l.cContext ?? cached.cContext,
              lSlop: l.lSlop ?? cached.lSlop,
              imageUrl: l.imageUrl ?? cached.imageUrl,
            };
          });
          const loadedIds = new Set(loaded.map(l => l.id));
          const nonDuplicates = prev.filter(c => !loadedIds.has(c.id));
          return [...merged, ...nonDuplicates];
        });
      }

      setSyncStatus("synced");

      // Backfill missing imageUrls from OG tags (max 10, fire-and-forget)
      backfillImageUrls();
    } catch (err) {
      console.error("[content] Failed to load from IC:", errMsg(err));
      setSyncStatus("offline");
      addNotification("Could not load content history from IC", "error");
    }
  }, [isAuthenticated, principal, addNotification]);
  loadFromICRef.current = loadFromIC;

  const syncBriefing = useCallback((state: BriefingState, nostrPubkey?: string | null) => {
    if (!actorRef.current || !isAuthenticated) return;
    void syncBriefingToCanister(actorRef.current, state, nostrPubkey ?? null).catch((err: unknown) => {
      console.warn("[content] Briefing sync to IC failed:", errMsg(err));
    });
  }, [isAuthenticated]);

  const value = useMemo(() => ({
    content, isAnalyzing, syncStatus,
    analyze, scoreText, validateItem, flagItem, addContent, clearDemoContent, loadFromIC, syncBriefing,
  }), [content, isAnalyzing, syncStatus, analyze, scoreText, validateItem, flagItem, addContent, clearDemoContent, loadFromIC, syncBriefing]);

  return (
    <ContentContext.Provider value={value}>
      {children}
    </ContentContext.Provider>
  );
}

export function useContent() {
  return useContext(ContentContext);
}
