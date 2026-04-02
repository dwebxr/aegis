"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useCurrentRef } from "@/hooks/useCurrentRef";
import { useAuth } from "./AuthContext";
import type { UserPreferenceProfile, UserContext, CustomFilterRule, NotificationPrefs } from "@/lib/preferences/types";
import type { TranslationPrefs } from "@/lib/translation/types";
import { createEmptyProfile, TOPIC_AFFINITY_CAP, TOPIC_AFFINITY_FLOOR } from "@/lib/preferences/types";
import { learn, getContext, hasEnoughData } from "@/lib/preferences/engine";
import { loadProfile, saveProfile, syncPreferencesToIC, loadPreferencesFromIC, mergeProfiles } from "@/lib/preferences/storage";
import { clamp } from "@/lib/utils/math";
import { errMsg } from "@/lib/utils/errors";
import { trackDomainValidation } from "@/lib/sources/discovery";

interface PreferenceState {
  profile: UserPreferenceProfile;
  userContext: UserContext | null;
  isPersonalized: boolean;
  onValidate: (topics: string[], author: string, composite: number, verdict: "quality" | "slop", sourceUrl?: string, itemId?: string) => void;
  onFlag: (topics: string[], author: string, composite: number, verdict: "quality" | "slop", itemId?: string) => void;
  setTopicAffinity: (topic: string, value: number) => void;
  removeTopicAffinity: (topic: string) => void;
  setQualityThreshold: (value: number) => void;
  addFilterRule: (rule: Omit<CustomFilterRule, "id" | "createdAt">) => void;
  removeFilterRule: (ruleId: string) => void;
  bookmarkItem: (id: string) => void;
  unbookmarkItem: (id: string) => void;
  setNotificationPrefs: (prefs: NotificationPrefs) => void;
  setTranslationPrefs: (prefs: TranslationPrefs) => void;
}

const emptyProfile = createEmptyProfile("");

const PreferenceContext = createContext<PreferenceState>({
  profile: emptyProfile,
  userContext: null,
  isPersonalized: false,
  onValidate: () => {},
  onFlag: () => {},
  setTopicAffinity: () => {},
  removeTopicAffinity: () => {},
  setQualityThreshold: () => {},
  addFilterRule: () => {},
  removeFilterRule: () => {},
  bookmarkItem: () => {},
  unbookmarkItem: () => {},
  setNotificationPrefs: () => {},
  setTranslationPrefs: () => {},
});

export function PreferenceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, principalText, identity } = useAuth();
  const [profile, setProfile] = useState<UserPreferenceProfile>(emptyProfile);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const icSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const identityRef = useCurrentRef(identity);
  const isAuthRef = useCurrentRef(isAuthenticated);
  const profileRef = useCurrentRef(profile);

  useEffect(() => {
    let cancelled = false;

    if (isAuthenticated && principalText && identity) {
      const local = loadProfile(principalText, (reason) => {
        window.dispatchEvent(new CustomEvent("aegis:notification", {
          detail: { message: reason, type: "error" },
        }));
      });
      setProfile(local);

      loadPreferencesFromIC(identity, principalText).then((icProfile) => {
        if (cancelled) return;
        if (!icProfile) {
          const hasData = local.totalValidated > 0 || local.totalFlagged > 0
            || Object.keys(local.topicAffinities).length > 0;
          if (hasData) void syncPreferencesToIC(identity, local).catch(err => {
            console.warn("[prefs] IC initial sync failed:", errMsg(err));
          });
          return;
        }
        const merged = mergeProfiles(local, icProfile);
        setProfile(merged);
        saveProfile(merged);

        if (merged.lastUpdated > icProfile.lastUpdated) {
          void syncPreferencesToIC(identity, merged).catch(err => {
            console.warn("[prefs] IC merge sync failed:", errMsg(err));
          });
        }
      }).catch((err) => {
        if (!cancelled) console.warn("[prefs] IC preference load failed:", errMsg(err));
      });
    } else {
      setProfile(emptyProfile);
    }

    return () => {
      cancelled = true;
      const ident = identityRef.current;
      if (icSyncTimeoutRef.current && ident) {
        clearTimeout(icSyncTimeoutRef.current);
        icSyncTimeoutRef.current = null;
        void syncPreferencesToIC(ident, profileRef.current).catch(err => {
          console.warn("[prefs] IC flush-on-auth-change failed:", errMsg(err));
        });
      }
    };
  }, [isAuthenticated, principalText, identity]);

  const debouncedSave = useCallback((p: UserPreferenceProfile) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (!saveProfile(p)) {
        console.error("[prefs] Preference save failed");
      }
    }, 500);
  }, []);

  const icSyncFailCountRef = useRef(0);
  const debouncedICSync = useCallback((p: UserPreferenceProfile) => {
    if (icSyncTimeoutRef.current) clearTimeout(icSyncTimeoutRef.current);
    icSyncTimeoutRef.current = setTimeout(() => {
      const ident = identityRef.current;
      if (!isAuthRef.current || !ident) return;
      syncPreferencesToIC(ident, p).then(() => {
        icSyncFailCountRef.current = 0;
      }).catch(err => {
        icSyncFailCountRef.current++;
        console.warn("[prefs] IC debounced sync failed:", errMsg(err));
        if (icSyncFailCountRef.current >= 3) {
          window.dispatchEvent(new CustomEvent("aegis:notification", {
            detail: { message: "Preference sync to IC unavailable", type: "error" },
          }));
          icSyncFailCountRef.current = 0; // reset to avoid spamming
        }
      });
    }, 3_000); // IC sync debounce: 3 seconds
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (icSyncTimeoutRef.current) clearTimeout(icSyncTimeoutRef.current);
    };
  }, []);

  // Periodic IC sync heartbeat — catches silently failed syncs every 10 minutes
  const lastSyncedAtRef = useRef(0);
  useEffect(() => {
    if (!isAuthenticated || !identity) return;
    const HEARTBEAT_MS = 10 * 60 * 1000; // 10 minutes
    const interval = setInterval(() => {
      const p = profileRef.current;
      if (p.lastUpdated > lastSyncedAtRef.current) {
        void syncPreferencesToIC(identity, p)
          .then(() => { lastSyncedAtRef.current = p.lastUpdated; })
          .catch(err => console.warn("[prefs] Heartbeat sync failed:", errMsg(err)));
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [isAuthenticated, identity]);

  const updateProfile = useCallback((mutate: (p: UserPreferenceProfile) => void) => {
    const next = structuredClone(profileRef.current);
    mutate(next);
    next.lastUpdated = Date.now();
    setProfile(next);
    debouncedSave(next);
    debouncedICSync(next);
  }, [debouncedSave, debouncedICSync]);

  /** Apply a learn event, remove bookmark if present, persist & sync. */
  const applyLearnEvent = useCallback((event: Parameters<typeof learn>[1], itemId?: string) => {
    let next = learn(profileRef.current, event);
    if (itemId && next.bookmarkedIds?.includes(itemId)) {
      next = { ...next, bookmarkedIds: next.bookmarkedIds.filter(bid => bid !== itemId) };
    }
    setProfile(next);
    debouncedSave(next);
    debouncedICSync(next);
    return next;
  }, [debouncedSave, debouncedICSync]);

  const onValidate = useCallback((topics: string[], author: string, composite: number, verdict: "quality" | "slop", sourceUrl?: string, itemId?: string) => {
    applyLearnEvent({ action: "validate", topics, author, composite, verdict }, itemId);
    trackDomainValidation(sourceUrl);
  }, [applyLearnEvent]);

  const onFlag = useCallback((topics: string[], author: string, composite: number, verdict: "quality" | "slop", itemId?: string) => {
    applyLearnEvent({ action: "flag", topics, author, composite, verdict }, itemId);
  }, [applyLearnEvent]);

  const setTopicAffinity = useCallback((topic: string, value: number) => {
    updateProfile(p => { p.topicAffinities[topic] = clamp(value, TOPIC_AFFINITY_FLOOR, TOPIC_AFFINITY_CAP); });
  }, [updateProfile]);

  const removeTopicAffinity = useCallback((topic: string) => {
    updateProfile(p => { delete p.topicAffinities[topic]; });
  }, [updateProfile]);

  const setQualityThreshold = useCallback((value: number) => {
    updateProfile(p => { p.calibration.qualityThreshold = clamp(value, 1, 9); });
  }, [updateProfile]);

  const addFilterRule = useCallback((rule: Omit<CustomFilterRule, "id" | "createdAt">) => {
    updateProfile(p => {
      p.customFilterRules = [...(p.customFilterRules ?? []), {
        ...rule,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: Date.now(),
      }];
    });
  }, [updateProfile]);

  const removeFilterRule = useCallback((ruleId: string) => {
    updateProfile(p => { p.customFilterRules = (p.customFilterRules ?? []).filter(r => r.id !== ruleId); });
  }, [updateProfile]);

  const bookmarkItem = useCallback((id: string) => {
    const existing = profileRef.current.bookmarkedIds ?? [];
    if (existing.includes(id)) return;
    updateProfile(p => { p.bookmarkedIds = [...(p.bookmarkedIds ?? []), id]; });
  }, [updateProfile]);

  const unbookmarkItem = useCallback((id: string) => {
    updateProfile(p => { p.bookmarkedIds = (p.bookmarkedIds ?? []).filter(bid => bid !== id); });
  }, [updateProfile]);

  const setNotificationPrefs = useCallback((prefs: NotificationPrefs) => {
    updateProfile(p => { p.notificationPrefs = prefs; });
  }, [updateProfile]);

  const setTranslationPrefs = useCallback((prefs: TranslationPrefs) => {
    updateProfile(p => { p.translationPrefs = prefs; });
  }, [updateProfile]);

  const isPersonalized = useMemo(() => hasEnoughData(profile), [profile]);
  const userContext = useMemo(() => isPersonalized ? getContext(profile) : null, [profile, isPersonalized]);

  const value = useMemo(() => ({
    profile, userContext, isPersonalized, onValidate, onFlag,
    setTopicAffinity, removeTopicAffinity, setQualityThreshold,
    addFilterRule, removeFilterRule,
    bookmarkItem, unbookmarkItem, setNotificationPrefs, setTranslationPrefs,
  }), [profile, userContext, isPersonalized, onValidate, onFlag, setTopicAffinity, removeTopicAffinity, setQualityThreshold, addFilterRule, removeFilterRule, bookmarkItem, unbookmarkItem, setNotificationPrefs, setTranslationPrefs]);

  return (
    <PreferenceContext.Provider value={value}>
      {children}
    </PreferenceContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferenceContext);
}
