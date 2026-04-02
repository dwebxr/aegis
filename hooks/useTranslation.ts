import { useCallback, useState, useRef, useEffect } from "react";
import { usePreferences } from "@/contexts/PreferenceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import { translateContent, type TranslateOptions } from "@/lib/translation/engine";
import { DEFAULT_TRANSLATION_PREFS } from "@/lib/translation/types";
import type { ContentItem } from "@/lib/types/content";
import type { TranslationResult } from "@/lib/translation/types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";

const MAX_CONCURRENT = 3;

interface UseTranslationReturn {
  /** Translate a single item by ID */
  translateItem: (itemId: string) => void;
  /** Check if a given item is currently being translated */
  isItemTranslating: (itemId: string) => boolean;
  /** Process items after scoring — auto-translate based on policy */
  autoTranslate: (item: ContentItem) => void;
}

export function useTranslation(
  items: ContentItem[],
  patchItem: (id: string, patch: Partial<ContentItem>) => void,
  actorRef: React.MutableRefObject<_SERVICE | null>,
): UseTranslationReturn {
  const { profile } = usePreferences();
  const { isAuthenticated } = useAuth();
  const { addNotification } = useNotify();
  const [translating, setTranslating] = useState<Set<string>>(new Set());
  const translatingRef = useRef(translating);
  translatingRef.current = translating;

  // Queue for auto-translate to avoid flooding API
  const queueRef = useRef<ContentItem[]>([]);
  const processingRef = useRef(false);

  const prefs = profile.translationPrefs ?? DEFAULT_TRANSLATION_PREFS;

  const doTranslate = useCallback(async (item: ContentItem) => {
    if (item.translation) return;
    if (translatingRef.current.has(item.id)) return;

    setTranslating(prev => new Set(prev).add(item.id));

    const opts: TranslateOptions = {
      text: item.text,
      reason: item.reason,
      targetLanguage: prefs.targetLanguage,
      backend: prefs.backend,
      actorRef,
      isAuthenticated,
    };

    let result: TranslationResult | null = null;
    try {
      result = await translateContent(opts);
    } catch (err) {
      addNotification(`Translation failed: ${errMsg(err)}`, "error");
    }

    setTranslating(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    if (result) {
      patchItem(item.id, { translation: result });
    }
  }, [prefs.targetLanguage, prefs.backend, actorRef, isAuthenticated, patchItem, addNotification]);

  // Process queued items with concurrency limit
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const batch = queueRef.current.splice(0, MAX_CONCURRENT);
      await Promise.allSettled(batch.map(item => doTranslate(item)));
    }

    processingRef.current = false;
  }, [doTranslate]);

  const translateItem = useCallback((itemId: string) => {
    const item = items.find(it => it.id === itemId);
    if (item) void doTranslate(item);
  }, [items, doTranslate]);

  const isItemTranslating = useCallback((itemId: string) => {
    return translating.has(itemId);
  }, [translating]);

  const autoTranslate = useCallback((item: ContentItem) => {
    if (prefs.policy === "manual") return;
    if (item.translation) return;
    if (translatingRef.current.has(item.id)) return;
    if (queueRef.current.some(q => q.id === item.id)) return;

    if (prefs.policy === "high_quality" && item.scores.composite < prefs.minScore) return;

    queueRef.current.push(item);
  }, [prefs.policy, prefs.minScore]);

  // Drain queue whenever items are added
  useEffect(() => {
    if (queueRef.current.length > 0) void processQueue();
  });

  return { translateItem, isItemTranslating, autoTranslate };
}
