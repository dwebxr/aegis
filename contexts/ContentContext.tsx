"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useCurrentRef } from "@/hooks/useCurrentRef";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { relativeTime } from "@/lib/utils/scores";
import { useNotify } from "./NotificationContext";
import { type ContentItem, scoredItemFields } from "@/lib/types/content";
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
import type { SaveEvaluationPayload, UpdateEvaluationPayload } from "@/lib/offline/actionQueue";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { ContentState, ContentSyncStatus, PreferenceCallbacks } from "./content/types";
import { loadCachedContent, saveCachedContent, clearCachedContent, truncatePreservingActioned } from "./content/cache";
import { runScoringCascade } from "./content/scoring";
import { toICEvaluation, syncToIC, drainOfflineQueue, loadFromICCanister } from "./content/icSync";
import { isDuplicateItem, deduplicateItems, filterNewItems } from "./content/dedup";

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
  patchItem: () => {},
  actorRef: { current: null },
  pendingActions: 0,
  isOnline: true,
});

export function ContentProvider({ children, preferenceCallbacks }: { children: React.ReactNode; preferenceCallbacks?: PreferenceCallbacks }) {
  const { addNotification } = useNotify();
  const { isAuthenticated, identity, principal } = useAuth();
  const [content, setContent] = useState<ContentItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<ContentSyncStatus>("idle");
  const [cacheChecked, setCacheChecked] = useState(false);
  const [pendingActions, setPendingActions] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const pendingItemsRef = useRef<ContentItem[]>([]);
  const actorRef = useRef<_SERVICE | null>(null);
  // The principal actorRef's actor was created for, so drains can confirm the actor
  // matches the current principal before replaying queued actions under it.
  const actorPrincipalRef = useRef<string | null>(null);
  const contentRef = useCurrentRef(content);
  const loadFromICRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const drainQueueRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const syncRetryRef = useRef(0);
  const syncRetryTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const backfillCleanupRef = useRef<(() => void) | null>(null);
  const backfillFnRef = useRef<() => (() => void)>(() => () => {});
  const principalText = principal ? principal.toText() : null;
  const prevPrincipalRef = useRef<string | null>(null);
  // Which principal the in-memory `content` currently reflects. The persist effect
  // uses it to avoid writing a stale (previous-user) `content` into the new
  // principal's — or the anonymous — cache bucket during a login/logout transition.
  // STATE (not a ref) so that reconciling it re-runs the persist effect — otherwise an
  // item added during a slow, empty cache load would never get persisted (the load
  // sets this without any other render).
  const [contentLoadedFor, setContentLoadedFor] = useState<string | null>(null);
  // Gates the post-load offline drain to once per cache-load cycle. Reset on every
  // principal change (in the load effect below) — including logout→login as the SAME
  // principal — so a fresh session re-drains rather than being blocked by a stale key.
  const postLoadDrainKeyRef = useRef<string | null>(null);

  // Load cached content scoped to the current principal. Re-runs on principal
  // change (login/logout/account switch) so User A's cache never leaks to B.
  useEffect(() => {
    let cancelled = false;
    const previous = prevPrincipalRef.current;
    const changed = previous !== principalText;
    // Storage purge only when switching between two distinct authenticated
    // principals — logging the same user back in must NOT destroy their cache.
    const isAccountSwitch = changed && previous !== null && principalText !== null;
    prevPrincipalRef.current = principalText;
    // Re-arm the post-load drain for this (re-)entered session — otherwise logout→login
    // as the same principal keeps the stale key and the post-load drain never re-runs.
    if (changed) postLoadDrainKeyRef.current = null;

    const next = async () => {
      if (changed && previous !== null) {
        // Drop in-memory state so a stale view of the previous user is never
        // rendered while the new bucket is being loaded.
        setContent([]);
        setPendingActions(0);
      }
      if (isAccountSwitch) {
        try {
          await clearCachedContent(previous);
        } catch (err) {
          console.warn("[content] Failed to purge cache for previous principal:", errMsg(err));
        }
      }
      const items = await loadCachedContent(principalText);
      if (!cancelled) {
        if (items.length > 0) setContent(items);
        // `content` now reflects this principal — re-runs the persist effect, which
        // also flushes anything added to `content` while the cache was still loading.
        setContentLoadedFor(principalText);
      }
    };
    next().catch(err => {
      console.warn("[content] Failed to load cached content:", errMsg(err));
    }).finally(() => {
      if (!cancelled) setCacheChecked(true);
    });
    return () => { cancelled = true; };
  }, [principalText]);

  const doSyncToIC = useCallback(<T extends "saveEvaluation" | "updateEvaluation">(
    promise: Promise<unknown>,
    actionType: T,
    payload: T extends "saveEvaluation" ? SaveEvaluationPayload : UpdateEvaluationPayload,
  ) => {
    syncToIC(promise, actionType, payload, setSyncStatus, setPendingActions, addNotification, principalText);
  }, [addNotification, principalText]);

  useEffect(() => {
    let stale = false;
    // Principal this actor-creation is for — recorded alongside the actor so drains can
    // verify actorRef belongs to the CURRENT principal (on a direct A→B switch actorRef
    // still holds A's actor until B's async create resolves).
    const effectPrincipal = principalText;
    if (isAuthenticated && identity) {
      createBackendActorAsync(identity)
        .then(actor => {
          if (stale) return;
          actorRef.current = actor;
          actorPrincipalRef.current = effectPrincipal;
          setSyncStatus("idle");
          // Drain the offline queue BEFORE loading from IC. Otherwise the fast
          // getUserEvaluations query can resolve before the slower queued update
          // lands, and the stale canister read clobbers a just-queued optimistic
          // action (the UI reverts a validated item until the next full reload).
          drainQueueRef.current()
            .catch((err: unknown) => console.warn("[content] Auto-drain offline queue failed:", errMsg(err)))
            .finally(() => {
              if (stale) return;
              loadFromICRef.current().catch((err: unknown) => {
                console.warn("[content] Auto-loadFromIC after actor creation failed:", errMsg(err));
              });
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
      // eslint-disable-next-line react-hooks/exhaustive-deps -- timer ref, not a DOM node
      clearTimeout(syncRetryTimerRef.current);
      syncRetryRef.current = 0;
    };
  }, [isAuthenticated, identity, addNotification]);

  // The actor-creation drain above can run before the content cache has loaded,
  // leaving a queued saveEvaluation as a transient "item not found" retry. Re-drain
  // once the cache has RECONCILED for this principal (contentLoadedFor set by the load
  // effect) so it syncs within the session, not only on the next reconnect/reload.
  // Gating on contentLoadedFor (not content.length) is essential: draining on stale or
  // partial content would retry-miss the queued item, and the once-per-principal guard
  // would then block the correct re-drain once the real cached content arrives.
  useEffect(() => {
    if (!isAuthenticated || !actorRef.current || contentLoadedFor !== principalText) return;
    if (postLoadDrainKeyRef.current === principalText) return;
    postLoadDrainKeyRef.current = principalText;
    drainQueueRef.current().catch((err: unknown) =>
      console.warn("[content] Post-load offline drain failed:", errMsg(err)));
  }, [contentLoadedFor, isAuthenticated, principalText]);

  const doDrainQueue = useCallback(async () => {
    const actor = actorRef.current;
    // Only drain when actorRef is the CURRENT principal's actor. During a direct A→B
    // switch it can still be A's until B's actor resolves; draining B's queued actions
    // then would replay them under A's caller (cross-account write / silent drop).
    if (!actor || !isAuthenticated || !principal || actorPrincipalRef.current !== principalText) return;
    // Tell the drain whether the cache has reconciled, so an item-not-found is retried
    // (ran before the cache loaded) vs dropped (genuinely evicted) — not left stuck.
    const contentReconciled = contentLoadedFor === principalText;
    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus, addNotification, contentReconciled);
  }, [isAuthenticated, principal, addNotification, contentLoadedFor, principalText]);
  drainQueueRef.current = doDrainQueue;

  const isOnline = useOnlineStatus(doDrainQueue);

  useEffect(() => {
    let cancelled = false;
    dequeueAll(principalText).then(a => {
      if (!cancelled) setPendingActions(a.length);
    }).catch((err) => {
      console.warn("[content] Failed to load pending action count:", errMsg(err));
    });
    return () => { cancelled = true; };
  }, [principalText]);

  useEffect(() => {
    // Skip while the principal just changed and the load effect hasn't yet
    // reconciled `content` to it — otherwise the previous user's content would be
    // written into the new (e.g. anonymous, on logout) cache bucket.
    if (contentLoadedFor !== principalText) return;
    saveCachedContent(content, principalText);
  }, [content, principalText, contentLoadedFor]);

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

  const scoreText = useCallback(async (text: string, userContext?: UserContext | null): Promise<AnalyzeResponse> => {
    return runScoringCascade(text, userContext, actorRef, isAuthenticated);
  }, [isAuthenticated]);

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
        ...scoredItemFields(result),
      };
      setContent(prev => truncatePreservingActioned([evaluation, ...prev]));

      if (actorRef.current && isAuthenticated && principal) {
        doSyncToIC(actorRef.current.saveEvaluation(toICEvaluation(evaluation, principal)), "saveEvaluation", { itemId: evaluation.id });
      }

      return result;
    } finally { setIsAnalyzing(false); }
  }, [scoreText, isAuthenticated, principal, addNotification, doSyncToIC]);

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
  }, [isAuthenticated, preferenceCallbacks, doSyncToIC]);

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
  }, [isAuthenticated, preferenceCallbacks, doSyncToIC]);

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
  }, [isAuthenticated, principal, doSyncToIC]);

  const addContentBuffered = useCallback((item: ContentItem) => {
    if (isDuplicateItem(item, contentRef.current) || isDuplicateItem(item, pendingItemsRef.current)) return;

    const owned = (!item.owner && isAuthenticated && principal)
      ? { ...item, owner: principal.toText() }
      : item;

    if (actorRef.current && isAuthenticated && principal) {
      doSyncToIC(actorRef.current.saveEvaluation(toICEvaluation(owned, principal)), "saveEvaluation", { itemId: owned.id });
    }

    pendingItemsRef.current.push(owned);
    setPendingCount(pendingItemsRef.current.length);

    if (pendingItemsRef.current.length >= MAX_PENDING_BUFFER) {
      const snapshot = pendingItemsRef.current;
      pendingItemsRef.current = [];
      setPendingCount(0);
      const items = deduplicateItems(snapshot);
      setContent(prev => {
        const fresh = filterNewItems(items, prev);
        return truncatePreservingActioned([...fresh, ...prev]);
      });
    }
  }, [isAuthenticated, principal, doSyncToIC]);

  const flushPendingItems = useCallback(() => {
    if (pendingItemsRef.current.length === 0) return;
    const items = deduplicateItems(pendingItemsRef.current);
    pendingItemsRef.current = [];
    setPendingCount(0);
    setContent(prev => {
      const fresh = filterNewItems(items, prev);
      return truncatePreservingActioned([...fresh, ...prev]);
    });
  }, []);

  const clearDemoContent = useCallback(() => setContent(prev => prev.filter(c => c.owner !== "")), []);

  const patchItem = useCallback((id: string, patch: Partial<ContentItem>) => {
    setContent(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }, []);

  const backfillImageUrls = useCallback((): (() => void) => {
    const items = contentRef.current
      .filter((c): c is ContentItem & { sourceUrl: string } => !!c.sourceUrl && !c.imageUrl && /^https?:\/\//i.test(c.sourceUrl))
      .slice(0, 30);
    if (items.length === 0) return () => {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    (async () => {
      try {
        const urls = items.map(item => item.sourceUrl);
        const res = await fetch("/api/fetch/ogimage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const results: Array<{ url: string; imageUrl: string | null }> = data.results || [];

        const urlToImage = new Map<string, string>();
        for (const r of results) {
          if (r.imageUrl) urlToImage.set(r.url, r.imageUrl);
        }
        if (urlToImage.size === 0) return;

        setContent(prev => prev.map(c => {
          if (c.imageUrl || !c.sourceUrl) return c;
          const img = urlToImage.get(c.sourceUrl);
          return img ? { ...c, imageUrl: img } : c;
        }));

        if (actorRef.current && isAuthenticated && principal) {
          for (const item of items) {
            const img = urlToImage.get(item.sourceUrl);
            if (!img) continue;
            void actorRef.current.saveEvaluation(toICEvaluation({ ...item, imageUrl: img }, principal)).catch((err: unknown) => {
              console.warn("[content] IC imageUrl backfill save failed:", errMsg(err));
              setSyncStatus("offline");
            });
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn("[content] Image backfill batch failed:", errMsg(err));
        }
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => { clearTimeout(timeout); controller.abort(); };
  }, [isAuthenticated, principal]);
  backfillFnRef.current = backfillImageUrls;

  const loadFromIC = useCallback(async () => {
    if (!actorRef.current || !isAuthenticated || !principal) return;
    await loadFromICCanister(
      actorRef.current, principal, setContent, setSyncStatus,
      syncRetryRef, syncRetryTimerRef, loadFromICRef, addNotification,
      backfillImageUrls, backfillCleanupRef,
    );
  }, [isAuthenticated, principal, addNotification, backfillImageUrls]);
  loadFromICRef.current = loadFromIC;

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
    analyze, scoreText, validateItem, flagItem, addContent, addContentBuffered, flushPendingItems, clearDemoContent, loadFromIC, syncBriefing, patchItem, actorRef,
  }), [content, isAnalyzing, syncStatus, cacheChecked, pendingActions, isOnline, pendingCount, analyze, scoreText, validateItem, flagItem, addContent, addContentBuffered, flushPendingItems, clearDemoContent, loadFromIC, syncBriefing, patchItem]);

  return (
    <ContentContext.Provider value={value}>
      {children}
    </ContentContext.Provider>
  );
}

export function useContent() {
  return useContext(ContentContext);
}
