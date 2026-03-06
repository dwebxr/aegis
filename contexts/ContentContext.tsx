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
import type { _SERVICE } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";
import { withTimeout } from "@/lib/utils/timeout";
import { recordUseful, recordSlop } from "@/lib/d2a/reputation";
import { recordPublishValidation, recordPublishFlag } from "@/lib/reputation/publishGate";
import { syncBriefingToCanister } from "@/lib/briefing/sync";
import type { BriefingState } from "@/lib/briefing/types";
import { dequeueAll } from "@/lib/offline/actionQueue";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { ContentState, PreferenceCallbacks } from "./content/types";
import { loadCachedContent, saveCachedContent, truncatePreservingActioned } from "./content/cache";
import { runScoringCascade } from "./content/scoring";
import { toICEvaluation, syncToIC, drainOfflineQueue, loadFromICCanister } from "./content/icSync";

const MAX_PENDING_BUFFER = 100;

const defaultAnalyzeResponse: AnalyzeResponse = { originality: 0, insight: 0, credibility: 0, composite: 0, verdict: "slop" as const, reason: "" };

const ContentContext = createContext<ContentState>({
  content: [],
  isAnalyzing: false,
  syncStatus: "idle",
  cacheChecked: false,
  analyze: async () => defaultAnalyzeResponse,
  scoreText: async () => defaultAnalyzeResponse,
  validateItem: () => {},
  flagItem: () => {},
  addContent: () => {},
  addContentBuffered: () => {},
  flushPendingItems: () => {},
  pendingCount: 0,
  clearDemoContent: () => {},
  loadFromIC: async () => {},
  syncBriefing: () => {},
  pendingActions: 0,
  isOnline: true,
});

/** Check whether `item` is a duplicate of any item in `existing`. */
function isDuplicateItem(item: ContentItem, existing: ContentItem[]): boolean {
  return existing.some(c =>
    (item.sourceUrl && c.sourceUrl === item.sourceUrl) ||
    (!item.sourceUrl && c.text === item.text),
  );
}

export function ContentProvider({ children, preferenceCallbacks }: { children: React.ReactNode; preferenceCallbacks?: PreferenceCallbacks }) {
  const { addNotification } = useNotify();
  const { isAuthenticated, identity, principal } = useAuth();
  const [content, setContent] = useState<ContentItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "offline">("idle");
  const [cacheChecked, setCacheChecked] = useState(false);
  const [pendingActions, setPendingActions] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const pendingItemsRef = useRef<ContentItem[]>([]);
  const actorRef = useRef<_SERVICE | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const loadFromICRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const drainQueueRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const syncRetryRef = useRef(0);
  const syncRetryTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const backfillCleanupRef = useRef<(() => void) | null>(null);
  const backfillFnRef = useRef<() => (() => void)>(() => () => {});

  // ─── Cache load on mount ───
  useEffect(() => {
    let cancelled = false;
    loadCachedContent().then(items => {
      if (!cancelled && items.length > 0) {
        setContent(items);
      }
    }).catch(err => {
      console.warn("[content] Failed to load cached content:", errMsg(err));
    }).finally(() => {
      if (!cancelled) setCacheChecked(true);
    });
    return () => { cancelled = true; };
  }, []);

  // ─── IC sync helper (fire-and-forget with offline queue) ───
  function doSyncToIC(promise: Promise<unknown>, actionType: "saveEvaluation" | "updateEvaluation", payload: unknown) {
    syncToIC(promise, actionType, payload, setSyncStatus, setPendingActions, addNotification);
  }

  // ─── Actor creation & auto-sync on auth ───
  useEffect(() => {
    let stale = false;
    if (isAuthenticated && identity) {
      createBackendActorAsync(identity)
        .then(actor => {
          if (stale) return;
          actorRef.current = actor;
          setSyncStatus("idle");
          loadFromICRef.current().catch((err: unknown) => {
            console.warn("[content] Auto-loadFromIC after actor creation failed:", errMsg(err));
          });
          drainQueueRef.current().catch((err: unknown) => {
            console.warn("[content] Auto-drain offline queue failed:", errMsg(err));
          });
        })
        .catch((err: unknown) => {
          if (stale) return;
          console.error("[content] Failed to create IC actor:", errMsg(err));
          actorRef.current = null;
          setSyncStatus("offline");
          addNotification("Could not connect to IC \u2014 content won't sync", "error");
        });
    } else {
      actorRef.current = null;
      setSyncStatus("offline");
    }
    return () => {
      stale = true;
      clearTimeout(syncRetryTimerRef.current);
      syncRetryRef.current = 0;
    };
  }, [isAuthenticated, identity, addNotification]);

  // ─── Offline queue drain ───
  const doDrainQueue = useCallback(async () => {
    const actor = actorRef.current;
    if (!actor || !isAuthenticated || !principal) return;
    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);
  }, [isAuthenticated, principal]);
  drainQueueRef.current = doDrainQueue;

  const isOnline = useOnlineStatus(doDrainQueue);

  // ─── Load pending action count on mount ───
  useEffect(() => {
    let cancelled = false;
    dequeueAll().then(a => {
      if (!cancelled) setPendingActions(a.length);
    }).catch((err) => {
      console.warn("[content] Failed to load pending action count:", errMsg(err));
    });
    return () => { cancelled = true; };
  }, []);

  // ─── Persist content to cache ───
  useEffect(() => {
    saveCachedContent(content);
  }, [content]);

  // ─── Timestamp refresh & visibility-based backfill ───
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

  // ─── Scoring cascade ───
  const scoreText = useCallback(async (text: string, userContext?: UserContext | null): Promise<AnalyzeResponse> => {
    return runScoringCascade(text, userContext, actorRef, isAuthenticated);
  }, [isAuthenticated]);

  // ─── Analyze (score + persist) ───
  const analyze = useCallback(async (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }): Promise<AnalyzeResponse> => {
    setIsAnalyzing(true);
    try {
      let result: AnalyzeResponse;
      try {
        result = await withTimeout(scoreText(text, userContext), 20_000, "Scoring cascade timeout (20s)");
      } catch (cascadeErr) {
        console.warn("[analyze] Scoring cascade failed/timed out, using heuristic:", errMsg(cascadeErr));
        const { heuristicScores } = await import("@/lib/ingestion/quickFilter");
        result = { ...heuristicScores(text), scoredByAI: false, scoringEngine: "heuristic" as const };
      }
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
        doSyncToIC(actorRef.current.saveEvaluation(toICEvaluation(evaluation, principal)), "saveEvaluation", { itemId: evaluation.id });
      }

      return result;
    } finally { setIsAnalyzing(false); }
  }, [scoreText, isAuthenticated, principal, addNotification]);

  // ─── Validate / Flag ───
  const validateItem = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    if (!item || item.validated) return;
    setContent(prev => prev.map(c => c.id === id ? { ...c, validated: true, flagged: false, validatedAt: c.validatedAt ?? Date.now() } : c));
    preferenceCallbacks?.onValidate?.(item.topics || [], item.author, item.scores.composite, item.verdict, item.sourceUrl, id);
    if (item.source === "nostr" && item.nostrPubkey) recordUseful(item.nostrPubkey);
    if (item.source === "manual" && item.nostrPubkey) recordPublishValidation(item.nostrPubkey);
    if (actorRef.current && isAuthenticated) {
      doSyncToIC(actorRef.current.updateEvaluation(id, true, false), "updateEvaluation", { id, validated: true, flagged: false });
    }
  }, [isAuthenticated, preferenceCallbacks, addNotification]);

  const flagItem = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    if (!item || item.flagged) return;
    setContent(prev => prev.map(c => c.id === id ? { ...c, flagged: true, validated: false } : c));
    preferenceCallbacks?.onFlag?.(item.topics || [], item.author, item.scores.composite, item.verdict, id);
    if (item.source === "nostr" && item.nostrPubkey) recordSlop(item.nostrPubkey);
    if (item.source === "manual" && item.nostrPubkey) recordPublishFlag(item.nostrPubkey);
    if (actorRef.current && isAuthenticated) {
      doSyncToIC(actorRef.current.updateEvaluation(id, false, true), "updateEvaluation", { id, validated: false, flagged: true });
    }
  }, [isAuthenticated, preferenceCallbacks, addNotification]);

  // ─── Add content ───
  const addContent = useCallback((item: ContentItem) => {
    const owned = (!item.owner && isAuthenticated && principal)
      ? { ...item, owner: principal.toText() }
      : item;

    setContent(prev => {
      if (isDuplicateItem(item, prev)) return prev;

      if (actorRef.current && isAuthenticated && principal) {
        doSyncToIC(actorRef.current.saveEvaluation(toICEvaluation(owned, principal)), "saveEvaluation", { itemId: owned.id });
      }

      return truncatePreservingActioned([owned, ...prev]);
    });
  }, [isAuthenticated, principal, addNotification]);

  const addContentBuffered = useCallback((item: ContentItem) => {
    const owned = (!item.owner && isAuthenticated && principal)
      ? { ...item, owner: principal.toText() }
      : item;

    if (actorRef.current && isAuthenticated && principal) {
      doSyncToIC(actorRef.current.saveEvaluation(toICEvaluation(owned, principal)), "saveEvaluation", { itemId: owned.id });
    }

    if (isDuplicateItem(item, contentRef.current) || isDuplicateItem(item, pendingItemsRef.current)) return;

    pendingItemsRef.current.push(owned);
    setPendingCount(pendingItemsRef.current.length);

    if (pendingItemsRef.current.length >= MAX_PENDING_BUFFER) {
      const items = pendingItemsRef.current;
      pendingItemsRef.current = [];
      setPendingCount(0);
      setContent(prev => {
        const fresh = items.filter(item => !isDuplicateItem(item, prev));
        return truncatePreservingActioned([...fresh, ...prev]);
      });
    }
  }, [isAuthenticated, principal, addNotification]);

  const flushPendingItems = useCallback(() => {
    if (pendingItemsRef.current.length === 0) return;
    const items = pendingItemsRef.current;
    pendingItemsRef.current = [];
    setPendingCount(0);
    setContent(prev => {
      const fresh = items.filter(item => !isDuplicateItem(item, prev));
      return truncatePreservingActioned([...fresh, ...prev]);
    });
  }, []);

  const clearDemoContent = () => setContent(prev => prev.filter(c => c.owner !== ""));

  // ─── Image backfill ───
  const backfillImageUrls = useCallback((): (() => void) => {
    const items = contentRef.current
      .filter(c => c.sourceUrl && !c.imageUrl && /^https?:\/\//i.test(c.sourceUrl))
      .slice(0, 30);
    if (items.length === 0) return () => {};

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
                setSyncStatus("offline");
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

  // ─── Load from IC ───
  const loadFromIC = useCallback(async () => {
    if (!actorRef.current || !isAuthenticated || !principal) return;
    await loadFromICCanister(
      actorRef.current, principal, setContent, setSyncStatus,
      syncRetryRef, syncRetryTimerRef, loadFromICRef, addNotification,
      backfillImageUrls, backfillCleanupRef,
    );
  }, [isAuthenticated, principal, addNotification, backfillImageUrls]);
  loadFromICRef.current = loadFromIC;

  // ─── Briefing sync ───
  const syncBriefing = useCallback((state: BriefingState, nostrPubkey?: string | null) => {
    if (!actorRef.current || !isAuthenticated) return;
    void syncBriefingToCanister(actorRef.current, state, nostrPubkey ?? null).catch((err: unknown) => {
      console.warn("[content] Briefing sync to IC failed:", errMsg(err));
      setSyncStatus("offline");
      addNotification("Briefing sync failed \u2014 will retry on next cycle", "error");
    });
  }, [isAuthenticated, addNotification]);

  const value = useMemo(() => ({
    content, isAnalyzing, syncStatus, cacheChecked, pendingActions, isOnline, pendingCount,
    analyze, scoreText, validateItem, flagItem, addContent, addContentBuffered, flushPendingItems, clearDemoContent, loadFromIC, syncBriefing,
  }), [content, isAnalyzing, syncStatus, cacheChecked, pendingActions, isOnline, pendingCount, analyze, scoreText, validateItem, flagItem, addContent, addContentBuffered, flushPendingItems, clearDemoContent, loadFromIC, syncBriefing]);

  return (
    <ContentContext.Provider value={value}>
      {children}
    </ContentContext.Provider>
  );
}

export function useContent() {
  return useContext(ContentContext);
}
