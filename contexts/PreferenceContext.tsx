"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";
import type { UserPreferenceProfile, UserContext } from "@/lib/preferences/types";
import { createEmptyProfile } from "@/lib/preferences/types";
import { learn, getContext, hasEnoughData } from "@/lib/preferences/engine";
import { loadProfile, saveProfile } from "@/lib/preferences/storage";

interface PreferenceState {
  profile: UserPreferenceProfile;
  userContext: UserContext | null;
  isPersonalized: boolean;
  onValidate: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
  onFlag: (topics: string[], author: string, composite: number, verdict: "quality" | "slop") => void;
}

const emptyProfile = createEmptyProfile("");

const PreferenceContext = createContext<PreferenceState>({
  profile: emptyProfile,
  userContext: null,
  isPersonalized: false,
  onValidate: () => {},
  onFlag: () => {},
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
    saveTimeoutRef.current = setTimeout(() => saveProfile(p), 500);
  }, []);

  useEffect(() => {
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, []);

  const onValidate = useCallback((topics: string[], author: string, composite: number, verdict: "quality" | "slop") => {
    setProfile(prev => {
      const next = learn(prev, { action: "validate", topics, author, composite, verdict });
      debouncedSave(next);
      return next;
    });
  }, [debouncedSave]);

  const onFlag = useCallback((topics: string[], author: string, composite: number, verdict: "quality" | "slop") => {
    setProfile(prev => {
      const next = learn(prev, { action: "flag", topics, author, composite, verdict });
      debouncedSave(next);
      return next;
    });
  }, [debouncedSave]);

  const isPersonalized = hasEnoughData(profile);
  const userContext = isPersonalized ? getContext(profile) : null;

  return (
    <PreferenceContext.Provider value={{ profile, userContext, isPersonalized, onValidate, onFlag }}>
      {children}
    </PreferenceContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferenceContext);
}
