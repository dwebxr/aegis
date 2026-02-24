"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAuth } from "./AuthContext";
import type { UserPreferenceProfile, UserContext } from "@/lib/preferences/types";
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
  onValidate: (topics: string[], author: string, composite: number, verdict: "quality" | "slop", sourceUrl?: string) => void;
  onFlag: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
  setTopicAffinity: (topic: string, value: number) => void;
  removeTopicAffinity: (topic: string) => void;
  setQualityThreshold: (value: number) => void;
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
});

export function PreferenceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, principalText, identity } = useAuth();
  const [profile, setProfile] = useState<UserPreferenceProfile>(emptyProfile);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const icSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for async callbacks (avoid stale closures)
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const isAuthRef = useRef(isAuthenticated);
  isAuthRef.current = isAuthenticated;

  useEffect(() => {
    let cancelled = false;

    if (isAuthenticated && principalText && identity) {
      const local = loadProfile(principalText);
      setProfile(local);

      loadPreferencesFromIC(identity, principalText).then((icProfile) => {
        if (cancelled) return;
        if (!icProfile) {
          // No IC data yet: push local to IC as initial backup (if non-empty)
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

        // If local was newer, push to IC
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

    return () => { cancelled = true; };
  }, [isAuthenticated, principalText, identity]);

  const debouncedSave = useCallback((p: UserPreferenceProfile) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (!saveProfile(p)) {
        console.error("[prefs] Preference save failed");
      }
    }, 500);
  }, []);

  const debouncedICSync = useCallback((p: UserPreferenceProfile) => {
    if (icSyncTimeoutRef.current) clearTimeout(icSyncTimeoutRef.current);
    icSyncTimeoutRef.current = setTimeout(() => {
      const ident = identityRef.current;
      if (!isAuthRef.current || !ident) return;
      void syncPreferencesToIC(ident, p).catch(err => {
        console.warn("[prefs] IC debounced sync failed:", errMsg(err));
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

  const profileRef = useRef(profile);
  profileRef.current = profile;

  const onValidate = useCallback((topics: string[], author: string, composite: number, verdict: "quality" | "slop", sourceUrl?: string) => {
    const next = learn(profileRef.current, { action: "validate", topics, author, composite, verdict });
    setProfile(next);
    debouncedSave(next);
    debouncedICSync(next);
    trackDomainValidation(sourceUrl);
  }, [debouncedSave, debouncedICSync]);

  const onFlag = useCallback((topics: string[], author: string, composite: number, verdict: "quality" | "slop") => {
    const next = learn(profileRef.current, { action: "flag", topics, author, composite, verdict });
    setProfile(next);
    debouncedSave(next);
    debouncedICSync(next);
  }, [debouncedSave, debouncedICSync]);

  const setTopicAffinity = useCallback((topic: string, value: number) => {
    const next = structuredClone(profileRef.current);
    next.topicAffinities[topic] = clamp(value, TOPIC_AFFINITY_FLOOR, TOPIC_AFFINITY_CAP);
    next.lastUpdated = Date.now();
    setProfile(next);
    debouncedSave(next);
    debouncedICSync(next);
  }, [debouncedSave, debouncedICSync]);

  const removeTopicAffinity = useCallback((topic: string) => {
    const next = structuredClone(profileRef.current);
    delete next.topicAffinities[topic];
    next.lastUpdated = Date.now();
    setProfile(next);
    debouncedSave(next);
    debouncedICSync(next);
  }, [debouncedSave, debouncedICSync]);

  const setQualityThreshold = useCallback((value: number) => {
    const next = structuredClone(profileRef.current);
    next.calibration.qualityThreshold = clamp(value, 1, 9);
    next.lastUpdated = Date.now();
    setProfile(next);
    debouncedSave(next);
    debouncedICSync(next);
  }, [debouncedSave, debouncedICSync]);

  const isPersonalized = useMemo(() => hasEnoughData(profile), [profile]);
  const userContext = useMemo(() => isPersonalized ? getContext(profile) : null, [profile, isPersonalized]);

  const value = useMemo(() => ({
    profile, userContext, isPersonalized, onValidate, onFlag,
    setTopicAffinity, removeTopicAffinity, setQualityThreshold,
  }), [profile, userContext, isPersonalized, onValidate, onFlag, setTopicAffinity, removeTopicAffinity, setQualityThreshold]);

  return (
    <PreferenceContext.Provider value={value}>
      {children}
    </PreferenceContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferenceContext);
}
