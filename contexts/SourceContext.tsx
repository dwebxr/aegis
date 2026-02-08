"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { createBackendActor } from "@/lib/ic/actor";
import { loadSources, saveSources } from "@/lib/sources/storage";
import type { SavedSource } from "@/lib/types/sources";
import type { _SERVICE, SourceConfigEntry } from "@/lib/ic/declarations";

interface SourceState {
  sources: SavedSource[];
  addSource: (source: Omit<SavedSource, "id" | "createdAt">) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;
  getSchedulerSources: () => Array<{ type: "rss" | "url" | "nostr"; config: Record<string, string>; enabled: boolean }>;
}

const SourceContext = createContext<SourceState>({
  sources: [],
  addSource: () => {},
  removeSource: () => {},
  toggleSource: () => {},
  getSchedulerSources: () => [],
});

export function SourceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, identity, principalText } = useAuth();
  const [sources, setSources] = useState<SavedSource[]>([]);
  const actorRef = useRef<_SERVICE | null>(null);

  // Create IC actor when authenticated
  useEffect(() => {
    if (isAuthenticated && identity) {
      try {
        actorRef.current = createBackendActor(identity);
      } catch {
        actorRef.current = null;
      }
    } else {
      actorRef.current = null;
    }
  }, [isAuthenticated, identity]);

  // Load sources from localStorage + IC on auth change
  useEffect(() => {
    if (!isAuthenticated || !principalText) {
      setSources([]);
      return;
    }

    // Load from localStorage immediately
    const local = loadSources(principalText);
    setSources(local);

    // Then merge from IC
    if (actorRef.current) {
      const principal = identity?.getPrincipal();
      if (principal) {
        actorRef.current.getUserSourceConfigs(principal)
          .then((icConfigs: SourceConfigEntry[]) => {
            if (icConfigs.length === 0) return;
            const icSources = icConfigs.map(icToSaved);
            setSources(prev => {
              const existingIds = new Set(prev.map(s => s.id));
              const newFromIC = icSources.filter(s => !existingIds.has(s.id));
              if (newFromIC.length === 0) return prev;
              const merged = [...prev, ...newFromIC];
              saveSources(principalText, merged);
              return merged;
            });
          })
          .catch((err: unknown) => console.warn("[sources] IC load failed:", err));
      }
    }
  }, [isAuthenticated, identity, principalText]);

  const persist = useCallback((next: SavedSource[]) => {
    if (principalText) saveSources(principalText, next);
  }, [principalText]);

  const addSource = useCallback((partial: Omit<SavedSource, "id" | "createdAt">) => {
    const source: SavedSource = { ...partial, id: uuidv4(), createdAt: Date.now() };
    setSources(prev => {
      const next = [...prev, source];
      persist(next);
      return next;
    });
    // Fire-and-forget IC save
    if (actorRef.current && isAuthenticated && identity) {
      const principal = identity.getPrincipal();
      actorRef.current.saveSourceConfig(savedToIC(source, principal))
        .catch((err: unknown) => console.warn("[sources] IC save failed:", err));
    }
  }, [persist, isAuthenticated, identity]);

  const removeSource = useCallback((id: string) => {
    setSources(prev => {
      const next = prev.filter(s => s.id !== id);
      persist(next);
      return next;
    });
    if (actorRef.current && isAuthenticated) {
      actorRef.current.deleteSourceConfig(id)
        .catch((err: unknown) => console.warn("[sources] IC delete failed:", err));
    }
  }, [persist, isAuthenticated]);

  const toggleSource = useCallback((id: string) => {
    setSources(prev => {
      const next = prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
      persist(next);
      // IC update for toggled source
      const toggled = next.find(s => s.id === id);
      if (toggled && actorRef.current && isAuthenticated && identity) {
        const principal = identity.getPrincipal();
        actorRef.current.saveSourceConfig(savedToIC(toggled, principal))
          .catch((err: unknown) => console.warn("[sources] IC toggle failed:", err));
      }
      return next;
    });
  }, [persist, isAuthenticated, identity]);

  const getSchedulerSources = useCallback((): Array<{ type: "rss" | "url" | "nostr"; config: Record<string, string>; enabled: boolean }> => {
    const result: Array<{ type: "rss" | "url" | "nostr"; config: Record<string, string>; enabled: boolean }> = [];
    for (const s of sources) {
      if (!s.enabled) continue;
      if (s.type === "rss" && s.feedUrl) {
        result.push({ type: "rss", config: { feedUrl: s.feedUrl }, enabled: true });
      } else if (s.type === "nostr") {
        result.push({
          type: "nostr",
          config: {
            relays: (s.relays || []).join(","),
            pubkeys: (s.pubkeys || []).join(","),
          },
          enabled: true,
        });
      }
    }
    return result;
  }, [sources]);

  return (
    <SourceContext.Provider value={{ sources, addSource, removeSource, toggleSource, getSchedulerSources }}>
      {children}
    </SourceContext.Provider>
  );
}

export function useSources() {
  return useContext(SourceContext);
}

// IC <-> SavedSource conversion helpers
function savedToIC(s: SavedSource, owner: import("@dfinity/principal").Principal): SourceConfigEntry {
  const config: Record<string, unknown> = {};
  if (s.feedUrl) config.feedUrl = s.feedUrl;
  if (s.relays) config.relays = s.relays;
  if (s.pubkeys) config.pubkeys = s.pubkeys;
  return {
    id: s.id,
    owner,
    sourceType: s.type,
    configJson: JSON.stringify({ label: s.label, ...config }),
    enabled: s.enabled,
    createdAt: BigInt(s.createdAt * 1_000_000),
  };
}

function icToSaved(ic: SourceConfigEntry): SavedSource {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(ic.configJson); } catch { /* use defaults */ }
  return {
    id: ic.id,
    type: ic.sourceType as "rss" | "nostr",
    label: (parsed.label as string) || ic.sourceType,
    enabled: ic.enabled,
    feedUrl: parsed.feedUrl as string | undefined,
    relays: parsed.relays as string[] | undefined,
    pubkeys: parsed.pubkeys as string[] | undefined,
    createdAt: Number(ic.createdAt) / 1_000_000,
  };
}
