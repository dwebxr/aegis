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

  // Initialized false (not from sessionStorage) so the first client render
  // matches the server-rendered landing page; the stored dismissal is
  // restored in an effect right after hydration.
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DEMO_BANNER_KEY) === "true") setBannerDismissed(true);
    } catch { console.debug("[demo] sessionStorage unavailable"); }
  }, []);

  const isDemoMode = !isAuthenticated && !isLoading;

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      sessionStorage.setItem(DEMO_BANNER_KEY, "true");
    } catch { console.debug("[demo] sessionStorage unavailable"); }
  }, []);

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
