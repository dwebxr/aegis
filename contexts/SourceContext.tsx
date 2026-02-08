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
  updateSource: (id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => void;
  getSchedulerSources: () => Array<{ type: "rss" | "url" | "nostr"; config: Record<string, string>; enabled: boolean }>;
}

const SourceContext = createContext<SourceState>({
  sources: [],
  addSource: () => {},
  removeSource: () => {},
  toggleSource: () => {},
  updateSource: () => {},
  getSchedulerSources: () => [],
});

export function SourceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, identity, principalText } = useAuth();
  const [sources, setSources] = useState<SavedSource[]>([]);
  const actorRef = useRef<_SERVICE | null>(null);

  // Create IC actor + load sources in a single effect to avoid race conditions
  useEffect(() => {
    if (!isAuthenticated || !identity || !principalText) {
      actorRef.current = null;
      setSources([]);
      return;
    }

    // Create actor synchronously
    let actor: _SERVICE | null = null;
    try {
      actor = createBackendActor(identity);
      actorRef.current = actor;
    } catch {
      actorRef.current = null;
    }

    // Load from localStorage immediately
    const local = loadSources(principalText);
    setSources(local);

    // Merge with IC (IC is the authoritative source for cross-device sync)
    if (actor) {
      const principal = identity.getPrincipal();
      actor.getUserSourceConfigs(principal)
        .then((icConfigs: SourceConfigEntry[]) => {
          const icSources = icConfigs.map(icToSaved);
          setSources(prev => {
            // Build lookup for merging
            const localMap = new Map<string, SavedSource>();
            prev.forEach(s => localMap.set(s.id, s));

            // IC wins for items that exist in IC (cross-device sync)
            const merged: SavedSource[] = [];
            icSources.forEach(icSource => {
              merged.push(icSource);
              localMap.delete(icSource.id);
            });
            // Add local-only items and push them to IC
            localMap.forEach(localSource => {
              merged.push(localSource);
              actor!.saveSourceConfig(savedToIC(localSource, principal))
                .catch((err: unknown) => console.warn("[sources] IC push local→IC failed:", err));
            });

            saveSources(principalText, merged);
            return merged;
          });
        })
        .catch((err: unknown) => console.warn("[sources] IC load failed:", err));
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

  const updateSource = useCallback((id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => {
    setSources(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...partial } : s);
      persist(next);
      const updated = next.find(s => s.id === id);
      if (updated && actorRef.current && isAuthenticated && identity) {
        const principal = identity.getPrincipal();
        actorRef.current.saveSourceConfig(savedToIC(updated, principal))
          .catch((err: unknown) => console.warn("[sources] IC update failed:", err));
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
    <SourceContext.Provider value={{ sources, addSource, removeSource, toggleSource, updateSource, getSchedulerSources }}>
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
