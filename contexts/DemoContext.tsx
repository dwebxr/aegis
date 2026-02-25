"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { useAuth } from "./AuthContext";

const DEMO_BANNER_KEY = "aegis_demo_banner_dismissed";

interface DemoState {
  isDemoMode: boolean;
  bannerDismissed: boolean;
  dismissBanner: () => void;
}

const DemoContext = createContext<DemoState>({
  isDemoMode: false,
  bannerDismissed: false,
  dismissBanner: () => {},
});

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(DEMO_BANNER_KEY) === "true";
    } catch {
      return false;
    }
  });

  const isDemoMode = !isAuthenticated && !isLoading;

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      sessionStorage.setItem(DEMO_BANNER_KEY, "true");
    } catch { console.debug("[demo] sessionStorage unavailable"); }
  }, []);

  // Reset banner on login
  useEffect(() => {
    if (isAuthenticated) setBannerDismissed(false);
  }, [isAuthenticated]);

  const value = useMemo(() => ({
    isDemoMode,
    bannerDismissed,
    dismissBanner,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissBanner is stable (empty deps useCallback)
  }), [isDemoMode, bannerDismissed]);

  return (
    <DemoContext.Provider value={value}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  return useContext(DemoContext);
}
