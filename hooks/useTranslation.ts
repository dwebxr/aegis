import { useCallback, useState, useRef, useEffect } from "react";
import { usePreferences } from "@/contexts/PreferenceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import { translateContent, type TranslateOptions } from "@/lib/translation/engine";
import { DEFAULT_TRANSLATION_PREFS } from "@/lib/translation/types";
import type { ContentItem } from "@/lib/types/content";
import type { _SERVICE } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";

/**
 * Maximum number of items being translated in parallel by the
 * auto-translate effect. Empirically verified (2026-04-12) that the
 * DFINITY LLM canister rejects the 3rd concurrent call from a single
 * caller with `IC LLM translation failed` in ~2 seconds. With
 * MAX_CONCURRENT=3 we were guaranteed to fail one of every three items
 * the moment they hit IC LLM. With MAX_CONCURRENT=2 the IC LLM canister
 * is happy and items pace themselves naturally. This was the root cause
 * of the systematic IC LLM failure that plagued the user across the
 * previous nine hotfixes.
 */
const MAX_CONCURRENT = 2;
const RETRY_INTERVAL_MS = 60_000;

/**
 * Maximum time to wait for the IC actor to be created before falling back
 * to running auto-translate without IC LLM in the cascade. If the actor
 * creation hangs (network issues, II problems, etc.), we don't want to
 * leave the user with completely no translations forever.
 */
const ACTOR_READY_TIMEOUT_MS = 5_000;

interface UseTranslationReturn {
  translateItem: (itemId: string) => void;
  isItemTranslating: (itemId: string) => boolean;
}

export function useTranslation(
  items: ContentItem[],
  patchItem: (id: string, patch: Partial<ContentItem>) => void,
  actorRef: React.MutableRefObject<_SERVICE | null>,
  syncStatus: "idle" | "syncing" | "synced" | "offline" = "offline",
): UseTranslationReturn {
  const { profile } = usePreferences();
  const { isAuthenticated } = useAuth();
  const { addNotification } = useNotify();
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());

  const prefs = profile.translationPrefs ?? DEFAULT_TRANSLATION_PREFS;

  // Refs for stable access inside async functions without re-renders
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const authRef = useRef(isAuthenticated);
  authRef.current = isAuthenticated;
  const patchRef = useRef(patchItem);
  patchRef.current = patchItem;
  const notifyRef = useRef(addNotification);
  notifyRef.current = addNotification;

  // Track attempted items to avoid infinite retry (keyed by target language)
  const attemptedRef = useRef<{ lang: string; skip: Set<string>; failed: Set<string> }>({
    lang: "", skip: new Set(), failed: new Set(),
  });
  if (attemptedRef.current.lang !== prefs.targetLanguage) {
    attemptedRef.current = { lang: prefs.targetLanguage, skip: new Set(), failed: new Set() };
  }

  // Active translation count for concurrency control
  const activeRef = useRef(0);

  // Bumped to force effect re-run after clearing the failed set
  const [retryTick, setRetryTick] = useState(0);

  // True once the cascade is fully populated (or the timeout fired). For
  // anonymous users this is true immediately. For authenticated users this
  // becomes true when syncStatus leaves "offline" (ContentContext finished
  // creating the IC actor) OR after ACTOR_READY_TIMEOUT_MS, whichever
  // comes first.
  //
  // Why this exists: without it, the auto-translate effect fires the
  // moment items load from the IDB cache (within ~10 ms of mount). At
  // that point ContentContext has not yet created the IC actor, so the
  // cascade attempts list is built without ic-llm. The cascade then runs
  // against claude-server only, which fails for items where Claude
  // returns no-kana (URLs, code, borderline content), throws, and the
  // user sees "Translation failed: ... claude-server: no kana" as a
  // false positive — once the actor was ready, IC LLM would have
  // produced a valid Japanese translation for many of those items.
  //
  // Gating the effect on isReady eliminates the cold-start race entirely.
  const [isReady, setIsReady] = useState<boolean>(() => !isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      // Anonymous user — cascade only ever has claude-server (and
      // optionally local backends), there's no actor to wait for.
      setIsReady(true);
      return;
    }
    if (syncStatus !== "offline") {
      // Actor was created by ContentContext — cascade can include ic-llm.
      setIsReady(true);
      return;
    }
    // Authenticated user but actor not yet ready. Reset isReady to false
    // (in case isAuthenticated just changed) and start a fallback timer
    // so we don't strand items if actor creation never completes.
    setIsReady(false);
    const timer = setTimeout(() => {
      setIsReady(true);
    }, ACTOR_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isAuthenticated, syncStatus]);

  // Debounce "all backends failed" notification — show once per language
  const failNotifiedLangRef = useRef("");

  const runTranslation = useCallback(async (item: ContentItem) => {
    const p = prefsRef.current;
    const opts: TranslateOptions = {
      text: item.text,
      reason: item.reason,
      targetLanguage: p.targetLanguage,
      backend: p.backend,
      actorRef,
      isAuthenticated: authRef.current,
    };

    setTranslatingIds(prev => new Set(prev).add(item.id));
    activeRef.current++;

    // translateContent surfaces failures in two ways:
    //  - returns "skip" when the model declared the content is already in
    //    the target language (ALREADY_IN_TARGET)
    //  - throws an Error with a diagnostic message when every backend
    //    in the cascade (or the chosen explicit backend) failed
    //  - returns a TranslationResult on success
    // We no longer special-case a "failed" return value because the
    // engine now throws with a specific reason instead. The legacy generic
    // "no translation backend available" notification was confusing
    // because it gave no information about which backend or why.
    let outcome: Awaited<ReturnType<typeof translateContent>> | null = null;
    try {
      outcome = await translateContent(opts);
    } catch (err) {
      attemptedRef.current.failed.add(item.id);
      if (failNotifiedLangRef.current !== prefsRef.current.targetLanguage) {
        failNotifiedLangRef.current = prefsRef.current.targetLanguage;
        notifyRef.current(`Translation failed: ${errMsg(err)}`, "error");
      }
    }

    activeRef.current--;
    setTranslatingIds(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    if (outcome && typeof outcome === "object") {
      patchRef.current(item.id, { translation: outcome });
    } else if (outcome === "skip") {
      attemptedRef.current.skip.add(item.id);
    }
    // Errors were already notified inside the catch block above.
  }, [actorRef]);

  const translateItem = useCallback((itemId: string) => {
    const item = items.find(it => it.id === itemId);
    if (item && !item.translation) void runTranslation(item);
  }, [items, runTranslation]);

  const isItemTranslating = useCallback((itemId: string) => {
    return translatingIds.has(itemId);
  }, [translatingIds]);

  // Auto-translate effect: runs when content or prefs change AND the
  // cascade is ready (cold-start race protection — see isReady above).
  useEffect(() => {
    if (prefs.policy === "manual" || prefs.policy === "off") return;
    if (!isReady) return;

    const pending = items.filter(item => {
      if (item.translation) return false;
      if (translatingIds.has(item.id)) return false;
      if (attemptedRef.current.skip.has(item.id)) return false;
      if (attemptedRef.current.failed.has(item.id)) return false;
      if (prefs.policy === "high_quality" && item.scores.composite < prefs.minScore) return false;
      return true;
    });

    if (pending.length === 0) return;

    // Launch up to MAX_CONCURRENT, respecting active count
    const slots = Math.max(0, MAX_CONCURRENT - activeRef.current);
    const batch = pending.slice(0, slots);
    for (const item of batch) {
      void runTranslation(item);
    }
  }, [items, prefs.policy, prefs.minScore, prefs.targetLanguage, translatingIds, runTranslation, retryTick, isReady]);

  // Clear failed AND skip sets when the IC actor becomes ready. With the
  // isReady gate above, the auto-translate effect should never run during
  // the cold-start window, so this shouldn't fire in practice. But if a
  // manual translateItem call (e.g. user clicked the Translate button)
  // ran during cold start AND the cascade promoted to skip via the
  // smart-model exception with a degraded backend list, the item would
  // be stranded. This hook recovers from that case too.
  //
  // The skip set is also cleared because the smart-model skip was the
  // only way for items to enter the skip set during cold start; legitimate
  // ALREADY_IN_TARGET skips are rare during cold start (the LLM hasn't
  // had a chance to respond yet for most items).
  const prevSyncStatusRef = useRef<typeof syncStatus>("offline");
  useEffect(() => {
    const prev = prevSyncStatusRef.current;
    prevSyncStatusRef.current = syncStatus;
    if (
      prev === "offline" &&
      syncStatus !== "offline" &&
      (attemptedRef.current.failed.size > 0 || attemptedRef.current.skip.size > 0)
    ) {
      attemptedRef.current.failed.clear();
      attemptedRef.current.skip.clear();
      failNotifiedLangRef.current = "";
      setRetryTick(t => t + 1);
    }
  }, [syncStatus]);

  // Clear failed set periodically to allow retry (every 60s)
  // Bump retryTick so the auto-translate effect re-runs after clearing.
  useEffect(() => {
    const interval = setInterval(() => {
      if (attemptedRef.current.failed.size > 0) {
        attemptedRef.current.failed.clear();
        failNotifiedLangRef.current = "";           // allow notification again
        setRetryTick(t => t + 1);                   // trigger effect re-run
      }
    }, RETRY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { translateItem, isItemTranslating };
}
