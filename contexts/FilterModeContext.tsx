"use client";
import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { FilterMode } from "@/lib/filtering/types";

interface FilterModeState {
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
}

const STORAGE_KEY = "aegis-filter-mode";

function loadPersistedMode(): FilterMode {
  if (typeof globalThis.localStorage === "undefined") return "lite";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "pro" || stored === "lite") return stored;
  return "lite";
}

const FilterModeContext = createContext<FilterModeState>({
  filterMode: "lite",
  setFilterMode: () => {},
});

export function FilterModeProvider({ children }: { children: React.ReactNode }) {
  const [filterMode, setFilterModeRaw] = useState<FilterMode>(loadPersistedMode);

  const setFilterMode = useCallback((mode: FilterMode) => {
    setFilterModeRaw(mode);
    if (typeof globalThis.localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  }, []);

  const value = useMemo(() => ({ filterMode, setFilterMode }), [filterMode, setFilterMode]);

  return (
    <FilterModeContext.Provider value={value}>
      {children}
    </FilterModeContext.Provider>
  );
}

export function useFilterMode() {
  return useContext(FilterModeContext);
}
