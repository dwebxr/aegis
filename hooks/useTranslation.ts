import { useCallback, useState, useRef } from "react";
import { usePreferences } from "@/contexts/PreferenceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import { translateContent, type TranslateOptions } from "@/lib/translation/engine";
import { DEFAULT_TRANSLATION_PREFS } from "@/lib/translation/types";
import type { ContentItem } from "@/lib/types/content";
import type { TranslationResult } from "@/lib/translation/types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";

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

    if (prefs.policy === "high_quality" && item.scores.composite < prefs.minScore) return;

    void doTranslate(item);
  }, [prefs.policy, prefs.minScore, doTranslate]);

  return { translateItem, isItemTranslating, autoTranslate };
}
