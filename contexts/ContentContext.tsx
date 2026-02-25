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
import { computeScoringCacheKey, computeProfileHash, lookupScoringCache, storeScoringCache } from "@/lib/scoring/cache";
import { encodeEngineInReason, decodeEngineFromReason, encodeTopicsInReason, decodeTopicsFromReason } from "@/lib/scoring/types";
import { syncBriefingToCanister } from "@/lib/briefing/sync";
import type { BriefingState } from "@/lib/briefing/types";
import { enqueueAction, dequeueAll, removeAction, incrementRetries } from "@/lib/offline/actionQueue";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

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

/** Scoring tier helpers — each returns AnalyzeResponse on success, throws on failure (for Promise.any). */
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
  } catch (err) {
    console.warn("[content] Failed to parse cached content:", errMsg(err));
    return [];
  }
}

function saveCachedContent(items: ContentItem[]): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(truncatePreservingActioned(items)));
  } catch (err) {
    console.warn("[content] localStorage save failed (quota?):", errMsg(err));
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
  pendingActions: number;
  isOnline: boolean;
}

type PreferenceCallbacks = {
  onValidate?: (topics: string[], author: string, composite: number, verdict: "quality" | "slop", sourceUrl?: string) => void;
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
  pendingActions: 0,
  isOnline: true,
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
  const [pendingActions, setPendingActions] = useState(0);
  const actorRef = useRef<_SERVICE | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const loadFromICRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const drainQueueRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const backfillCleanupRef = useRef<(() => void) | null>(null);
  const backfillFnRef = useRef<() => (() => void)>(() => () => {});

  /** Fire-and-forget IC call with offline queue fallback. */
  function syncToIC(promise: Promise<unknown>, actionType: "saveEvaluation" | "updateEvaluation", payload: unknown) {
    void promise.catch(async (err: unknown) => {
      console.warn("[content] IC sync failed:", errMsg(err));
      setSyncStatus("offline");
      await enqueueAction(actionType, payload);
      setPendingActions(p => p + 1);
      addNotification("Saved locally \u2014 will sync when online", "error");
    });
  }

  useEffect(() => {
    let stale = false;
    if (isAuthenticated && identity) {
      createBackendActorAsync(identity)
        .then(actor => {
          if (stale) return; // identity changed during async creation
          actorRef.current = actor;
          setSyncStatus("idle");
          // Actor is now ready — auto-load IC data + drain offline queue
          loadFromICRef.current().catch((err: unknown) => {
            console.warn("[content] Auto-loadFromIC after actor creation failed:", errMsg(err));
          });
          drainQueueRef.current().catch((err: unknown) => {
            console.warn("[content] Auto-drain offline queue failed:", errMsg(err));
          });
        })
        .catch((err: unknown) => {
          if (stale) return; // identity changed — ignore stale error
          console.error("[content] Failed to create IC actor:", errMsg(err));
          actorRef.current = null;
          setSyncStatus("offline");
          addNotification("Could not connect to IC — content won't sync", "error");
        });
    } else {
      actorRef.current = null;
      setSyncStatus("offline");
    }
    return () => { stale = true; };
  }, [isAuthenticated, identity, addNotification]);

  const drainOfflineQueue = useCallback(async () => {
    const actor = actorRef.current;
    if (!actor || !isAuthenticated || !principal) return;
    const actions = await dequeueAll();
    if (actions.length === 0) return;
    console.info(`[offline-queue] Draining ${actions.length} pending action(s)`);
    const MAX_RETRIES = 5;
    for (const action of actions) {
      if (action.retries >= MAX_RETRIES) {
        console.warn(`[offline-queue] Dropping action ${action.id} after ${MAX_RETRIES} retries`);
        await removeAction(action.id!);
        continue;
      }
      try {
        if (action.type === "updateEvaluation") {
          const { id, validated, flagged } = action.payload as { id: string; validated: boolean; flagged: boolean };
          await actor.updateEvaluation(id, validated, flagged);
        } else if (action.type === "saveEvaluation") {
          const { itemId } = action.payload as { itemId: string };
          const item = contentRef.current.find(c => c.id === itemId);
          if (item) {
            await actor.saveEvaluation(toICEvaluation(item, principal));
          }
        }
        await removeAction(action.id!);
      } catch (err) {
        console.warn(`[offline-queue] Replay failed for action ${action.id}:`, errMsg(err));
        await incrementRetries(action.id!);
      }
    }
    const remaining = await dequeueAll();
    setPendingActions(remaining.length);
    if (remaining.length === 0) {
      setSyncStatus("synced");
      console.info("[offline-queue] All pending actions synced");
    }
  }, [isAuthenticated, principal]);
  drainQueueRef.current = drainOfflineQueue;

  const isOnline = useOnlineStatus(drainOfflineQueue);

  // Load pending count on mount
  useEffect(() => {
    let cancelled = false;
    dequeueAll().then(a => {
      if (!cancelled) setPendingActions(a.length);
    }).catch((err) => {
      console.warn("[content] Failed to load pending action count:", errMsg(err));
    });
    return () => { cancelled = true; };
  }, []);

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
    const timestampTimer = setInterval(updateTimestamps, 60_000);
    const onVisible = () => {
      if (!document.hidden) {
        updateTimestamps();
        // Re-trigger backfill for items still missing thumbnails
        backfillCleanupRef.current?.();
        backfillCleanupRef.current = backfillFnRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timestampTimer);
      document.removeEventListener("visibilitychange", onVisible);
      backfillCleanupRef.current?.();
    };
  }, []);

  /** Run the full scoring cascade: Ollama → WebLLM → BYOK → IC LLM → Server → Heuristic. No side effects. */
  const scoreText = useCallback(async (text: string, userContext?: UserContext | null): Promise<AnalyzeResponse> => {
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
    if (isOllamaEnabled()) localTiers.push(tryOllama(text, topics));
    if (isWebLLMEnabled()) localTiers.push(tryWebLLM(text, topics));
    if (userApiKey) localTiers.push(tryBYOK(text, userContext, userApiKey));

    if (localTiers.length > 0) {
      try {
        result = await Promise.any(localTiers);
      } catch (err) {
        // All local tiers failed — log aggregate and fall through
        const reasons = err instanceof AggregateError
          ? err.errors.map(e => errMsg(e)).join("; ")
          : errMsg(err);
        console.warn("[scoreText] All local tiers failed:", reasons);
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
  }, [isAuthenticated]);

  const analyze = useCallback(async (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }): Promise<AnalyzeResponse> => {
    setIsAnalyzing(true);
    try {
      const result = await scoreText(text, userContext);
      if (result.scoringEngine === "heuristic") {
        addNotification("AI unavailable \u2014 scored with basic heuristics", "info");
      }

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
        syncToIC(actorRef.current.saveEvaluation(toICEvaluation(evaluation, principal)), "saveEvaluation", { itemId: evaluation.id });
      }

      return result;
    } finally { setIsAnalyzing(false); }
  }, [scoreText, isAuthenticated, principal, addNotification]);

  const validateItem = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    if (!item || item.validated) return;
    setContent(prev => prev.map(c => c.id === id ? { ...c, validated: true, validatedAt: c.validatedAt ?? Date.now() } : c));
    preferenceCallbacks?.onValidate?.(item.topics || [], item.author, item.scores.composite, item.verdict, item.sourceUrl);
    if (item.source === "nostr" && item.nostrPubkey) recordUseful(item.nostrPubkey);
    if (item.source === "manual" && item.nostrPubkey) recordPublishValidation(item.nostrPubkey);
    if (actorRef.current && isAuthenticated) {
      syncToIC(actorRef.current.updateEvaluation(id, true, item.flagged), "updateEvaluation", { id, validated: true, flagged: item.flagged });
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
      syncToIC(actorRef.current.updateEvaluation(id, item.validated, true), "updateEvaluation", { id, validated: item.validated, flagged: true });
    }
  }, [isAuthenticated, preferenceCallbacks, addNotification]);

  const addContent = useCallback((item: ContentItem) => {
    const owned = (!item.owner && isAuthenticated && principal)
      ? { ...item, owner: principal.toText() }
      : item;

    setContent(prev => {
      // Dedup check inside updater so `prev` is always the latest state
      // (contentRef.current can be stale when multiple addContent calls are batched)
      const isDuplicate = prev.some(c =>
        (item.sourceUrl && c.sourceUrl === item.sourceUrl) ||
        (!item.sourceUrl && c.text === item.text),
      );
      if (isDuplicate) return prev;

      // IC save (fire-and-forget) — safe to call inside updater
      if (actorRef.current && isAuthenticated && principal) {
        syncToIC(actorRef.current.saveEvaluation(toICEvaluation(owned, principal)), "saveEvaluation", { itemId: owned.id });
      }

      return truncatePreservingActioned([owned, ...prev]);
    });
  }, [isAuthenticated, principal, addNotification]);

  const clearDemoContent = useCallback(() => {
    setContent(prev => prev.filter(c => c.owner !== ""));
  }, []);

  const backfillImageUrls = useCallback((): (() => void) => {
    const items = contentRef.current
      .filter(c => c.sourceUrl && !c.imageUrl && /^https?:\/\//i.test(c.sourceUrl))
      .slice(0, 30);
    if (items.length === 0) return () => {};

    // Stagger requests to avoid rate limiting; return cleanup function
    const timers: ReturnType<typeof setTimeout>[] = [];
    items.forEach((item, i) => {
      timers.push(setTimeout(async () => {
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
          if (actorRef.current && isAuthenticated) {
            const updated = contentRef.current.find(c => c.id === item.id);
            if (updated && principal) {
              void actorRef.current.saveEvaluation(toICEvaluation({ ...updated, imageUrl: data.imageUrl }, principal)).catch((err: unknown) => {
                console.warn("[content] IC imageUrl backfill save failed:", errMsg(err));
              });
            }
          }
        } catch (err) {
          console.debug("[content] Image backfill failed for", item.id, errMsg(err));
        }
      }, i * 300));
    });
    return () => timers.forEach(clearTimeout);
  }, [isAuthenticated, principal]);
  backfillFnRef.current = backfillImageUrls;

  const loadFromIC = useCallback(async () => {
    if (!actorRef.current || !isAuthenticated || !principal) return;
    setSyncStatus("syncing");

    try {
      const PAGE_SIZE = BigInt(100);
      const MAX_PAGES = 50; // Safety limit: 5000 evaluations max
      const allEvals: Awaited<ReturnType<_SERVICE["getUserEvaluations"]>> = [];
      let offset = BigInt(0);
      for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
        const page = await actorRef.current.getUserEvaluations(principal, offset, PAGE_SIZE);
        allEvals.push(...page);
        if (BigInt(page.length) < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        if (pageNum === MAX_PAGES - 1) {
          console.warn(`[content] Pagination limit reached (${MAX_PAGES} pages, ${allEvals.length} items). Some evaluations may not be loaded.`);
        }
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
      backfillCleanupRef.current?.();
      backfillCleanupRef.current = backfillImageUrls();
    } catch (err) {
      console.error("[content] Failed to load from IC:", errMsg(err));
      setSyncStatus("offline");
      addNotification("IC sync unavailable — using local data", "error");
    }
  }, [isAuthenticated, principal, addNotification, backfillImageUrls]);
  loadFromICRef.current = loadFromIC;

  const syncBriefing = useCallback((state: BriefingState, nostrPubkey?: string | null) => {
    if (!actorRef.current || !isAuthenticated) return;
    void syncBriefingToCanister(actorRef.current, state, nostrPubkey ?? null).catch((err: unknown) => {
      console.warn("[content] Briefing sync to IC failed:", errMsg(err));
      setSyncStatus("offline");
    });
  }, [isAuthenticated]);

  const value = useMemo(() => ({
    content, isAnalyzing, syncStatus, pendingActions, isOnline,
    analyze, scoreText, validateItem, flagItem, addContent, clearDemoContent, loadFromIC, syncBriefing,
  }), [content, isAnalyzing, syncStatus, pendingActions, isOnline, analyze, scoreText, validateItem, flagItem, addContent, clearDemoContent, loadFromIC, syncBriefing]);

  return (
    <ContentContext.Provider value={value}>
      {children}
    </ContentContext.Provider>
  );
}

export function useContent() {
  return useContext(ContentContext);
}
