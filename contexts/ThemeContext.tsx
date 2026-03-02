"use client";
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

export type ThemeMode = "dark" | "light";

interface ThemeState {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
}

const STORAGE_KEY = "aegis-theme";

function loadPersistedTheme(): ThemeMode {
  if (typeof globalThis.localStorage === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* Safari private mode or storage disabled */ }
  return "dark";
}

const ThemeContext = createContext<ThemeState>({
  theme: "dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeRaw] = useState<ThemeMode>(loadPersistedTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeRaw(mode);
    document.documentElement.setAttribute("data-theme", mode);
    if (typeof globalThis.localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
