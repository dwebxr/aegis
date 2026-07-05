import { useCallback, useState, useRef, useEffect } from "react";
import { usePreferences } from "@/contexts/PreferenceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import { translateContent, type TranslateOptions } from "@/lib/translation/engine";
import {
  DEFAULT_TRANSLATION_PREFS,
  TranslationBackendUnavailableError,
  type TranslationBackend,
  type TranslationSkip,
} from "@/lib/translation/types";
import type { ContentItem } from "@/lib/types/content";
import type { ContentSyncStatus } from "@/contexts/content/types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";

// Parallel in-flight translations. Bounded by the /api/translate rate
// limit (60/min) — at ~5s per call, 4 in-flight produces ~0.8 req/sec,
// well under the cap. Scoring has its own IC-LLM concurrency gate in
// `contexts/content/scoring.ts` and is unaffected by this constant.
const MAX_CONCURRENT = 4;
const RETRY_INTERVAL_MS = 60_000;

// Cap on how long we wait for the IC actor before starting auto-
// translate without it in the cascade. Prevents stranding items if
// actor creation hangs (bad network, II problems, etc.).
const ACTOR_READY_TIMEOUT_MS = 5_000;

const AUTO_NO_BACKEND_MESSAGE =
  "自動翻訳のバックエンドがありません — Internet Identityでログインする、Settings→FeedsでローカルLLMを有効化、またはAPIキーを設定してください";
const EXPLICIT_BACKEND_UNAVAILABLE_MESSAGE = (backendLabel: string) =>
  `選択した翻訳バックエンド(${backendLabel})が利用できません — Settings→Translationで変更してください`;
const AUTO_ALL_BACKENDS_FAILED_MESSAGE =
  "一部の記事を翻訳できませんでした(IC LLMが不安定な場合があります)。未翻訳の記事は展開してTranslateで再試行できます";

const BACKEND_LABELS: Record<TranslationBackend, string> = {
  auto: "Auto",
  browser: "Browser",
  local: "Local",
  cloud: "Cloud",
  ic: "IC LLM",
};

type TranslationCallerKind = "auto" | "manual";

function isTranslationSkip(outcome: Awaited<ReturnType<typeof translateContent>>): outcome is TranslationSkip {
  return typeof outcome === "object" && outcome !== null && "status" in outcome && outcome.status === "skip";
}

interface UseTranslationReturn {
  translateItem: (itemId: string) => void;
  isItemTranslating: (itemId: string) => boolean;
}

export function useTranslation(
  items: ContentItem[],
  patchItem: (id: string, patch: Partial<ContentItem>) => void,
  actorRef: React.MutableRefObject<_SERVICE | null>,
  syncStatus: ContentSyncStatus = "offline",
): UseTranslationReturn {
  const { profile } = usePreferences();
  const { isAuthenticated } = useAuth();
  const { addNotification } = useNotify();
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());

  const prefs = profile.translationPrefs ?? DEFAULT_TRANSLATION_PREFS;

  // Refs let async callbacks read live values without re-creating on every render.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const authRef = useRef(isAuthenticated);
  authRef.current = isAuthenticated;
  const patchRef = useRef(patchItem);
  patchRef.current = patchItem;
  const notifyRef = useRef(addNotification);
  notifyRef.current = addNotification;

  // Attempted-item sets, keyed by target language so a language switch resets them.
  const attemptedRef = useRef<{ lang: string; skip: Set<string>; failed: Set<string> }>({
    lang: "", skip: new Set(), failed: new Set(),
  });
  if (attemptedRef.current.lang !== prefs.targetLanguage) {
    attemptedRef.current = { lang: prefs.targetLanguage, skip: new Set(), failed: new Set() };
  }

  const activeRef = useRef(0);
  const autoActiveRef = useRef(0);

  // Bumped to force the auto-translate effect to re-run after clearing the failed set.
  const [retryTick, setRetryTick] = useState(0);

  // Gates auto-translate until the IC actor is ready (authenticated
  // users) or immediately (anonymous users). Without the gate, the
  // effect fires the moment items load from IDB — before ContentContext
  // has created the actor — and ic-llm is absent from the cascade.
  // Items that would have succeeded via ic-llm are then mis-skipped by
  // the downstream backends. ACTOR_READY_TIMEOUT_MS is the fallback so
  // a hung actor creation doesn't strand items forever.
  const [isReady, setIsReady] = useState<boolean>(() => !isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated || syncStatus !== "offline") {
      setIsReady(true);
      return;
    }
    setIsReady(false);
    const timer = setTimeout(() => setIsReady(true), ACTOR_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isAuthenticated, syncStatus]);

  // Debounce infrastructure error notifications per language; skip-based
  // visibility notifications are once per hook session.
  const failNotifiedLangRef = useRef("");
  const autoNoBackendNotifiedRef = useRef(false);
  const explicitBackendUnavailableNotifiedRef = useRef(false);
  const autoAllBackendsFailedNotifiedRef = useRef(false);
  const pendingAllBackendsFailedRef = useRef(false);

  const runTranslation = useCallback(async (item: ContentItem, callerKind: TranslationCallerKind) => {
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
    if (callerKind === "auto") autoActiveRef.current++;

    // translateContent throws on transport failure. THROWN failures notify on
    // every caller kind — a manual Translate tap that dies silently is exactly
    // the invisible-failure class this feature fix targets (and the pre-change
    // behavior notified manual failures too). Only SKIP-based visibility
    // notifications further down are auto-only, because a manual skip is
    // directly observable at the button.
    let outcome: Awaited<ReturnType<typeof translateContent>> | null = null;
    try {
      outcome = await translateContent(opts);
    } catch (err) {
      attemptedRef.current.failed.add(item.id);
      if (err instanceof TranslationBackendUnavailableError) {
        if (!explicitBackendUnavailableNotifiedRef.current) {
          explicitBackendUnavailableNotifiedRef.current = true;
          notifyRef.current(EXPLICIT_BACKEND_UNAVAILABLE_MESSAGE(BACKEND_LABELS[p.backend]), "error");
        }
      } else if (failNotifiedLangRef.current !== prefsRef.current.targetLanguage) {
        failNotifiedLangRef.current = prefsRef.current.targetLanguage;
        notifyRef.current(`Translation failed: ${errMsg(err)}`, "error");
      }
    }

    activeRef.current--;
    if (callerKind === "auto") autoActiveRef.current--;
    setTranslatingIds(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    if (outcome && !isTranslationSkip(outcome)) {
      patchRef.current(item.id, { translation: outcome });
    } else if (outcome && isTranslationSkip(outcome)) {
      attemptedRef.current.skip.add(item.id);
      // no-backend notifies for BOTH caller kinds: a manual Translate tap with
      // no usable backend produces no visible change at all, which is the same
      // invisible failure as the auto path — and the message is the actionable
      // fix (login / enable a local LLM / add a key). already-in-target stays
      // silent (correct behavior); all-backends-failed aggregates auto-only
      // (pre-existing manual semantics, and per-item spam is the alternative).
      if (outcome.reason === "no-backend") {
        if (p.backend === "auto") {
          if (!autoNoBackendNotifiedRef.current) {
            autoNoBackendNotifiedRef.current = true;
            notifyRef.current(AUTO_NO_BACKEND_MESSAGE, "error");
          }
        } else if (!explicitBackendUnavailableNotifiedRef.current) {
          explicitBackendUnavailableNotifiedRef.current = true;
          notifyRef.current(EXPLICIT_BACKEND_UNAVAILABLE_MESSAGE(BACKEND_LABELS[p.backend]), "error");
        }
      } else if (callerKind === "auto" && outcome.reason === "all-backends-failed") {
        pendingAllBackendsFailedRef.current = true;
      }
    }

    if (callerKind === "auto" && autoActiveRef.current === 0 && pendingAllBackendsFailedRef.current) {
      pendingAllBackendsFailedRef.current = false;
      if (!autoAllBackendsFailedNotifiedRef.current) {
        autoAllBackendsFailedNotifiedRef.current = true;
        notifyRef.current(AUTO_ALL_BACKENDS_FAILED_MESSAGE, "info");
      }
    }
  }, [actorRef]);

  const translateItem = useCallback((itemId: string) => {
    const item = items.find(it => it.id === itemId);
    if (item && !item.translation) void runTranslation(item, "manual");
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

    const slots = Math.max(0, MAX_CONCURRENT - activeRef.current);
    for (const item of pending.slice(0, slots)) {
      void runTranslation(item, "auto");
    }
  }, [items, prefs.policy, prefs.minScore, prefs.targetLanguage, translatingIds, runTranslation, retryTick, isReady]);

  // Clear failed AND skip sets when the IC actor becomes ready. The
  // isReady gate above normally prevents cold-start misfires, but a
  // manual translateItem call (e.g. user clicked the Translate button)
  // can still bypass the gate and get stranded on a degraded cascade.
  // Clearing both sets gives those items a second chance.
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

  // Periodic retry: clear the failed set every RETRY_INTERVAL_MS so
  // transient infra problems get a second chance. retryTick forces
  // the auto-translate effect to re-evaluate.
  useEffect(() => {
    const interval = setInterval(() => {
      if (attemptedRef.current.failed.size > 0) {
        attemptedRef.current.failed.clear();
        failNotifiedLangRef.current = "";
        setRetryTick(t => t + 1);
      }
    }, RETRY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { translateItem, isItemTranslating };
}
