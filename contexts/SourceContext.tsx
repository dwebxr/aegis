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
  syncStatus: "idle" | "syncing" | "synced" | "error";
  addSource: (source: Omit<SavedSource, "id" | "createdAt">) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;
  updateSource: (id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => void;
  getSchedulerSources: () => Array<{ type: "rss" | "url" | "nostr"; config: Record<string, string>; enabled: boolean }>;
}

const SourceContext = createContext<SourceState>({
  sources: [],
  syncStatus: "idle",
  addSource: () => {},
  removeSource: () => {},
  toggleSource: () => {},
  updateSource: () => {},
  getSchedulerSources: () => [],
});

export function SourceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, identity, principalText } = useAuth();
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const actorRef = useRef<_SERVICE | null>(null);

  // Keep refs in sync with latest values to avoid stale closures
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const isAuthRef = useRef(isAuthenticated);
  isAuthRef.current = isAuthenticated;
  const principalTextRef = useRef(principalText);
  principalTextRef.current = principalText;

  // Ensure actor uses current identity (invalidate on identity change)
  useEffect(() => {
    actorRef.current = null;
  }, [identity]);

  // Get or create actor using latest identity from ref
  function getActor(): _SERVICE | null {
    if (!isAuthRef.current || !identityRef.current) return null;
    if (actorRef.current) return actorRef.current;
    try {
      const actor = createBackendActor(identityRef.current);
      actorRef.current = actor;
      return actor;
    } catch (err) {
      console.error("[sources] Failed to create IC actor:", err);
      return null;
    }
  }

  // Save a source to IC using refs (never stale)
  function saveToIC(source: SavedSource): void {
    const actor = getActor();
    const id = identityRef.current;
    if (!actor || !id) {
      console.warn("[sources] IC save skipped: actor=", !!actor, "identity=", !!id);
      return;
    }
    const principal = id.getPrincipal();
    actor.saveSourceConfig(savedToIC(source, principal))
      .then((resultId) => console.log("[sources] IC save OK:", resultId))
      .catch((err: unknown) => console.error("[sources] IC save FAILED:", err));
  }

  // Load sources from localStorage + IC on auth change
  useEffect(() => {
    if (!isAuthenticated || !identity || !principalText) {
      actorRef.current = null;
      setSources([]);
      setSyncStatus("idle");
      return;
    }

    // Load from localStorage immediately
    const local = loadSources(principalText);
    setSources(local);

    // Create actor directly (not via ref, since we have identity here)
    let actor: _SERVICE | null = null;
    try {
      actor = createBackendActor(identity);
      actorRef.current = actor;
    } catch (err) {
      console.error("[sources] Actor creation failed in effect:", err);
      setSyncStatus("error");
      return;
    }

    setSyncStatus("syncing");
    const principal = identity.getPrincipal();
    actor.getUserSourceConfigs(principal)
      .then((icConfigs: SourceConfigEntry[]) => {
        const icSources = icConfigs.map(icToSaved);
        setSources(prev => {
          const localMap = new Map<string, SavedSource>();
          prev.forEach(s => localMap.set(s.id, s));

          const merged: SavedSource[] = [];
          icSources.forEach(icSource => {
            merged.push(icSource);
            localMap.delete(icSource.id);
          });
          // Push local-only items to IC
          localMap.forEach(localSource => {
            actor!.saveSourceConfig(savedToIC(localSource, principal))
              .then(() => console.log("[sources] Pushed local→IC:", localSource.label))
              .catch((err: unknown) => console.error("[sources] Push local→IC failed:", err));
          });

          saveSources(principalText, merged);
          return merged;
        });
        setSyncStatus("synced");
      })
      .catch((err: unknown) => {
        console.error("[sources] IC load failed:", err);
        setSyncStatus("error");
      });
  }, [isAuthenticated, identity, principalText]);

  const persist = useCallback((next: SavedSource[]) => {
    const pt = principalTextRef.current;
    if (pt) saveSources(pt, next);
  }, []);

  const addSource = useCallback((partial: Omit<SavedSource, "id" | "createdAt">) => {
    const source: SavedSource = { ...partial, id: uuidv4(), createdAt: Date.now() };
    setSources(prev => {
      const next = [...prev, source];
      persist(next);
      return next;
    });
    saveToIC(source);
  }, [persist]);

  const removeSource = useCallback((id: string) => {
    setSources(prev => {
      const next = prev.filter(s => s.id !== id);
      persist(next);
      return next;
    });
    const actor = getActor();
    if (actor) {
      actor.deleteSourceConfig(id)
        .catch((err: unknown) => console.error("[sources] IC delete failed:", err));
    }
  }, [persist]);

  const toggleSource = useCallback((id: string) => {
    setSources(prev => {
      const next = prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
      persist(next);
      const toggled = next.find(s => s.id === id);
      if (toggled) saveToIC(toggled);
      return next;
    });
  }, [persist]);

  const updateSource = useCallback((id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => {
    setSources(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...partial } : s);
      persist(next);
      const updated = next.find(s => s.id === id);
      if (updated) saveToIC(updated);
      return next;
    });
  }, [persist]);

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
    <SourceContext.Provider value={{ sources, syncStatus, addSource, removeSource, toggleSource, updateSource, getSchedulerSources }}>
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
    createdAt: BigInt(s.createdAt) * BigInt(1_000_000),
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
