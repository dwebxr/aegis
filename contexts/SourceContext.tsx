"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { useNotify } from "./NotificationContext";
import { createBackendActor, createBackendActorAsync } from "@/lib/ic/actor";
import { loadSources, saveSources } from "@/lib/sources/storage";
import type { SavedSource } from "@/lib/types/sources";
import type { _SERVICE, SourceConfigEntry } from "@/lib/ic/declarations";
import { errMsg } from "@/lib/utils/errors";

interface SourceState {
  sources: SavedSource[];
  syncStatus: "idle" | "syncing" | "synced" | "error";
  syncError: string;
  addSource: (source: Omit<SavedSource, "id" | "createdAt">) => boolean;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;
  updateSource: (id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => void;
  getSchedulerSources: () => Array<{ type: "rss" | "url" | "nostr"; config: Record<string, string>; enabled: boolean }>;
}

const SourceContext = createContext<SourceState>({
  sources: [],
  syncStatus: "idle",
  syncError: "",
  addSource: () => false,
  removeSource: () => {},
  toggleSource: () => {},
  updateSource: () => {},
  getSchedulerSources: () => [],
});

export function SourceProvider({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotify();
  const { isAuthenticated, identity, principalText } = useAuth();
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const actorRef = useRef<_SERVICE | null>(null);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

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

  function getActor(): _SERVICE | null {
    if (!isAuthRef.current || !identityRef.current) return null;
    if (actorRef.current) return actorRef.current;
    try {
      const actor = createBackendActor(identityRef.current);
      actorRef.current = actor;
      return actor;
    } catch {
      return null;
    }
  }

  function saveToIC(source: SavedSource): void {
    const actor = getActor();
    const id = identityRef.current;
    if (!actor || !id) return;
    const principal = id.getPrincipal();
    actor.saveSourceConfig(savedToIC(source, principal))
      .catch((err: unknown) => {
        console.error("[sources] IC save FAILED:", err);
        setSyncStatus("error");
        setSyncError("Failed to save source to IC");
        addNotification("Source saved locally but IC sync failed", "error");
      });
  }

  // Load sources from localStorage + IC on auth change
  useEffect(() => {
    if (!isAuthenticated || !identity || !principalText) {
      actorRef.current = null;
      setSources([]);
      setSyncStatus("idle");
      setSyncError("");
      return;
    }

    // Load from localStorage immediately
    const local = loadSources(principalText);
    setSources(local);

    // Async: create actor and query IC
    const doSync = async () => {
      let actor: _SERVICE;
      try {
        actor = await createBackendActorAsync(identity);
        actorRef.current = actor;
      } catch (err) {
        const msg = errMsg(err);
        console.error("[sources] actor creation failed:", msg);
        setSyncStatus("error");
        setSyncError("Actor: " + msg);
        addNotification("Could not connect to IC for source sync", "error");
        return;
      }

      setSyncStatus("syncing");
      try {
        const principal = identity.getPrincipal();
        const icConfigs = await actor.getUserSourceConfigs(principal);

        const icSources = icConfigs.map(icToSaved);
        let localOnly: SavedSource[] = [];
        setSources(prev => {
          const localMap = new Map<string, SavedSource>();
          prev.forEach(s => localMap.set(s.id, s));

          const merged: SavedSource[] = [];
          icSources.forEach(icSource => {
            merged.push(icSource);
            localMap.delete(icSource.id);
          });
          localOnly = Array.from(localMap.values());
          localOnly.forEach(s => merged.push(s));

          saveSources(principalText, merged);
          return merged;
        });
        // Push local-only items to IC (outside state updater)
        for (const localSource of localOnly) {
          actor.saveSourceConfig(savedToIC(localSource, principal))
            .catch((e: unknown) => {
              console.error("[sources] push local→IC failed:", e);
              addNotification("Some sources failed to sync to IC", "error");
            });
        }
        setSyncStatus("synced");
        setSyncError("");
      } catch (err) {
        const msg = errMsg(err);
        console.error("[sources] IC query failed:", msg, err);
        setSyncStatus("error");
        setSyncError(msg);
        addNotification("Failed to load sources from IC", "error");
      }
    };
    doSync();
  }, [isAuthenticated, identity, principalText]);

  const persist = useCallback((next: SavedSource[]) => {
    const pt = principalTextRef.current;
    if (pt) saveSources(pt, next);
  }, []);

  const addSource = useCallback((partial: Omit<SavedSource, "id" | "createdAt">): boolean => {
    // Duplicate check: same feedUrl (RSS) or same relays (Nostr)
    const existing = sourcesRef.current;
    if (partial.type === "rss" && partial.feedUrl) {
      if (existing.some(s => s.type === "rss" && s.feedUrl === partial.feedUrl)) return false;
    } else if (partial.type === "nostr" && partial.relays) {
      const key = [...partial.relays].sort().join(",");
      if (existing.some(s => s.type === "nostr" && s.relays && [...s.relays].sort().join(",") === key)) return false;
    }
    const source: SavedSource = { ...partial, id: uuidv4(), createdAt: Date.now() };
    setSources(prev => {
      const next = [...prev, source];
      persist(next);
      return next;
    });
    saveToIC(source);
    return true;
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
        .catch((err: unknown) => {
          console.error("[sources] IC delete failed:", err);
          setSyncStatus("error");
          setSyncError("Failed to delete source from IC");
        });
    }
  }, [persist]);

  const toggleSource = useCallback((id: string) => {
    setSources(prev => {
      const next = prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
      persist(next);
      return next;
    });
    const source = sourcesRef.current.find(s => s.id === id);
    if (source) saveToIC({ ...source, enabled: !source.enabled });
  }, [persist]);

  const updateSource = useCallback((id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => {
    setSources(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...partial } : s);
      persist(next);
      return next;
    });
    const source = sourcesRef.current.find(s => s.id === id);
    if (source) saveToIC({ ...source, ...partial });
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

  const value = useMemo(() => ({
    sources, syncStatus, syncError, addSource, removeSource, toggleSource, updateSource, getSchedulerSources,
  }), [sources, syncStatus, syncError, addSource, removeSource, toggleSource, updateSource, getSchedulerSources]);

  return (
    <SourceContext.Provider value={value}>
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
  try { parsed = JSON.parse(ic.configJson); } catch (err) { console.warn(`[sources] Corrupted configJson for source ${ic.id}:`, err); }
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
