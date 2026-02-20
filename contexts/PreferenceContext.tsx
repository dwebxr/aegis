"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAuth } from "./AuthContext";
import type { UserPreferenceProfile, UserContext } from "@/lib/preferences/types";
import { createEmptyProfile, TOPIC_AFFINITY_CAP, TOPIC_AFFINITY_FLOOR } from "@/lib/preferences/types";
import { learn, getContext, hasEnoughData } from "@/lib/preferences/engine";
import { loadProfile, saveProfile } from "@/lib/preferences/storage";
import { clamp } from "@/lib/utils/math";

interface PreferenceState {
  profile: UserPreferenceProfile;
  userContext: UserContext | null;
  isPersonalized: boolean;
  onValidate: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
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
  const { isAuthenticated, principalText } = useAuth();
  const [profile, setProfile] = useState<UserPreferenceProfile>(emptyProfile);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isAuthenticated && principalText) {
      setProfile(loadProfile(principalText));
    } else {
      setProfile(emptyProfile);
    }
  }, [isAuthenticated, principalText]);

  const debouncedSave = useCallback((p: UserPreferenceProfile) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (!saveProfile(p)) {
        console.error("[prefs] Preference save failed");
      }
    }, 500);
  }, []);

  useEffect(() => {
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, []);

  const profileRef = useRef(profile);
  profileRef.current = profile;

  const onValidate = useCallback((topics: string[], author: string, composite: number, verdict: "quality" | "slop") => {
    const next = learn(profileRef.current, { action: "validate", topics, author, composite, verdict });
    setProfile(next);
    debouncedSave(next);
  }, [debouncedSave]);

  const onFlag = useCallback((topics: string[], author: string, composite: number, verdict: "quality" | "slop") => {
    const next = learn(profileRef.current, { action: "flag", topics, author, composite, verdict });
    setProfile(next);
    debouncedSave(next);
  }, [debouncedSave]);

  const setTopicAffinity = useCallback((topic: string, value: number) => {
    const next = structuredClone(profileRef.current);
    next.topicAffinities[topic] = clamp(value, TOPIC_AFFINITY_FLOOR, TOPIC_AFFINITY_CAP);
    next.lastUpdated = Date.now();
    setProfile(next);
    debouncedSave(next);
  }, [debouncedSave]);

  const removeTopicAffinity = useCallback((topic: string) => {
    const next = structuredClone(profileRef.current);
    delete next.topicAffinities[topic];
    next.lastUpdated = Date.now();
    setProfile(next);
    debouncedSave(next);
  }, [debouncedSave]);

  const setQualityThreshold = useCallback((value: number) => {
    const next = structuredClone(profileRef.current);
    next.calibration.qualityThreshold = clamp(value, 1, 9);
    next.lastUpdated = Date.now();
    setProfile(next);
    debouncedSave(next);
  }, [debouncedSave]);

  const isPersonalized = hasEnoughData(profile);
  const userContext = isPersonalized ? getContext(profile) : null;

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
