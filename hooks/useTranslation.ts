import { useCallback, useState, useRef, useEffect } from "react";
import { usePreferences } from "@/contexts/PreferenceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import { translateContent, type TranslateOptions } from "@/lib/translation/engine";
import { DEFAULT_TRANSLATION_PREFS } from "@/lib/translation/types";
import type { ContentItem } from "@/lib/types/content";
import type { _SERVICE } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";

const MAX_CONCURRENT = 3;
const RETRY_INTERVAL_MS = 60_000;

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

  // Auto-translate effect: runs when content or prefs change
  useEffect(() => {
    if (prefs.policy === "manual" || prefs.policy === "off") return;

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
  }, [items, prefs.policy, prefs.minScore, prefs.targetLanguage, translatingIds, runTranslation, retryTick]);

  // Clear failed set when the IC actor becomes ready. The most common
  // failure mode for the user is: page loads → useTranslation effect
  // fires immediately with actorRef.current === null (actor not yet
  // created) → cascade only includes claude-server → claude-server hits
  // rate limit or returns no-kana for some items → those items go into
  // attemptedRef.failed and are stuck for 60s.
  //
  // When syncStatus transitions out of "offline" (actor was just created
  // by ContentContext), wipe the failed set and bump retryTick so the
  // auto-translate effect re-runs with IC LLM now in the cascade. This
  // recovers from the cold-start race within seconds instead of minutes.
  const prevSyncStatusRef = useRef<typeof syncStatus>("offline");
  useEffect(() => {
    const prev = prevSyncStatusRef.current;
    prevSyncStatusRef.current = syncStatus;
    if (prev === "offline" && syncStatus !== "offline" && attemptedRef.current.failed.size > 0) {
      attemptedRef.current.failed.clear();
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
