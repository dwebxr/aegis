"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { useDemo } from "./DemoContext";
import { DEMO_SOURCES } from "@/lib/demo/sources";
import { useNotify } from "./NotificationContext";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { loadSources, saveSources, inferPlatform } from "@/lib/sources/storage";
import type { SavedSource } from "@/lib/types/sources";
import { SOURCE_PLATFORMS } from "@/lib/types/sources";
import type { _SERVICE, SourceConfigEntry } from "@/lib/ic/declarations";
import { errMsg, errMsgShort, handleICSessionError } from "@/lib/utils/errors";
import { getSourceKey, resetSourceErrors } from "@/lib/ingestion/sourceState";

interface SourceState {
  sources: SavedSource[];
  syncStatus: "idle" | "syncing" | "synced" | "error";
  syncError: string;
  addSource: (source: Omit<SavedSource, "id" | "createdAt">) => boolean;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;
  updateSource: (id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => void;
  getSchedulerSources: () => Array<{ type: "rss" | "url" | "nostr" | "farcaster"; config: Record<string, string>; enabled: boolean; platform?: import("@/lib/types/sources").SourcePlatform }>;
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
  const { isDemoMode } = useDemo();
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const actorRef = useRef<_SERVICE | null>(null);
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  // Keep refs in sync with latest values to avoid stale closures
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const isAuthRef = useRef(isAuthenticated);
  isAuthRef.current = isAuthenticated;
  const principalTextRef = useRef(principalText);
  principalTextRef.current = principalText;

  useEffect(() => {
    actorRef.current = null;
  }, [identity]);

  function getActor(): _SERVICE | null {
    if (!isAuthRef.current || !identityRef.current) return null;
    return actorRef.current;
  }

  function saveToIC(source: SavedSource): void {
    const actor = getActor();
    const ident = identityRef.current;
    if (!actor || !ident) {
      if (isAuthRef.current) {
        addNotification("Saved locally — IC sync pending", "info");
      }
      return;
    }
    void actor.saveSourceConfig(savedToIC(source, ident.getPrincipal()))
      .catch((err: unknown) => {
        console.error("[sources] IC save FAILED:", errMsg(err));
        setSyncStatus("error");
        setSyncError("Failed to save source to IC");
        addNotification("Source saved locally but IC sync failed", "error");
      });
  }

  useEffect(() => {
    if (!isAuthenticated || !identity || !principalText) {
      actorRef.current = null;
      setSources([]);
      setSyncStatus("idle");
      setSyncError("");
      return;
    }

    let cancelled = false;
    const local = loadSources(principalText);
    setSources(local);

    const doSync = async () => {
      let actor: _SERVICE;
      try {
        actor = await createBackendActorAsync(identity);
        if (cancelled) return;
        actorRef.current = actor;
      } catch (err) {
        if (cancelled) return;
        if (handleICSessionError(err)) return;
        const msg = errMsg(err);
        console.error("[sources] actor creation failed:", msg);
        setSyncStatus("error");
        setSyncError("Actor: " + msg);
        addNotification(`IC sync unavailable — ${errMsgShort(err)}`, "error");
        return;
      }

      setSyncStatus("syncing");
      try {
        const principal = identity.getPrincipal();

        const pendingDeletes = pendingDeletesRef.current;
        if (pendingDeletes.size > 0) {
          const toDelete = Array.from(pendingDeletes);
          const results = await Promise.allSettled(
            toDelete.map(id => actor.deleteSourceConfig(id))
          );
          if (cancelled) return;
          results.forEach((res, idx) => {
            if (res.status === "fulfilled") pendingDeletes.delete(toDelete[idx]);
            else console.warn("[sources] pending delete failed:", toDelete[idx], errMsg(res.reason));
          });
        }

        const icConfigs = await actor.getUserSourceConfigs(principal);
        if (cancelled) return;

        const icSources = icConfigs.map(icToSaved)
          .filter((s): s is SavedSource => s !== null)
          .filter(s => !pendingDeletes.has(s.id));
        let localOnly: SavedSource[] = [];
        setSources(prev => {
          const icIds = new Set(icSources.map(s => s.id));
          const localById = new Map(prev.map(s => [s.id, s]));
          localOnly = prev.filter(s => !icIds.has(s.id));
          // Backfill platform on IC sources: prefer local platform, then infer
          for (const ic of icSources) {
            if (!ic.platform) {
              ic.platform = localById.get(ic.id)?.platform || inferPlatform(ic) || undefined;
            }
          }
          const merged = [...icSources, ...localOnly];
          saveSources(principalText, merged);
          return merged;
        });
        let pushFailed = false;
        await Promise.all(
          localOnly.map(localSource =>
            actor.saveSourceConfig(savedToIC(localSource, principal))
              .catch((e: unknown) => {
                console.error("[sources] push local→IC failed:", errMsg(e));
                pushFailed = true;
              })
          )
        );
        if (cancelled) return;
        if (pushFailed) {
          setSyncStatus("error");
          setSyncError("Some sources failed to sync to IC");
          addNotification("Some sources failed to sync to IC", "error");
        } else {
          setSyncStatus("synced");
          setSyncError("");
        }
      } catch (err) {
        if (cancelled) return;
        if (handleICSessionError(err)) return;
        console.error("[sources] IC query failed:", errMsg(err), err);
        setSyncStatus("error");
        setSyncError(errMsg(err));
        addNotification(`IC sync unavailable — ${errMsgShort(err)}`, "error");
      }
    };
    doSync().catch(err => {
      if (!cancelled) console.error("[sources] Unhandled doSync error:", errMsg(err));
    });

    return () => { cancelled = true; };
  }, [isAuthenticated, identity, principalText]);

  useEffect(() => {
    if (isDemoMode) setSources(DEMO_SOURCES);
  }, [isDemoMode]);

  const persist = useCallback((next: SavedSource[]) => {
    const pt = principalTextRef.current;
    if (pt) saveSources(pt, next);
  }, []);

  const addSource = useCallback((partial: Omit<SavedSource, "id" | "createdAt">): boolean => {
    if (isDemoMode) return false;
    // Duplicate check: same feedUrl (RSS) or same relays (Nostr)
    const existing = sourcesRef.current;
    if (partial.type === "rss" && partial.feedUrl) {
      if (existing.some(s => s.type === "rss" && s.feedUrl === partial.feedUrl)) return false;
    } else if (partial.type === "nostr" && partial.relays) {
      const key = [...partial.relays].sort().join(",");
      if (existing.some(s => s.type === "nostr" && s.relays && [...s.relays].sort().join(",") === key)) return false;
    } else if (partial.type === "farcaster" && partial.fid) {
      if (existing.some(s => s.type === "farcaster" && s.fid === partial.fid)) return false;
    }
    const source: SavedSource = { ...partial, id: uuidv4(), createdAt: Date.now() };
    setSources(prev => {
      const next = [...prev, source];
      persist(next);
      return next;
    });
    saveToIC(source);
    return true;
  }, [persist, isDemoMode]);

  const removeSource = useCallback((id: string) => {
    if (isDemoMode) return;
    // Reset error state so re-adding the same source starts fresh
    const toRemove = sourcesRef.current.find(s => s.id === id);
    if (toRemove) {
      const config: Record<string, string> = {};
      if (toRemove.feedUrl) config.feedUrl = toRemove.feedUrl;
      if (toRemove.relays) config.relays = toRemove.relays.join(",");
      if (toRemove.fid) config.fid = String(toRemove.fid);
      if (toRemove.username) config.username = toRemove.username;
      resetSourceErrors(getSourceKey(toRemove.type, config));
    }
    setSources(prev => {
      const next = prev.filter(s => s.id !== id);
      persist(next);
      return next;
    });
    const actor = getActor();
    if (actor) {
      actor.deleteSourceConfig(id)
        .then(() => { pendingDeletesRef.current.delete(id); })
        .catch((err: unknown) => {
          console.error("[sources] IC delete failed:", errMsg(err));
          pendingDeletesRef.current.add(id);
          setSyncStatus("error");
          setSyncError("Failed to delete source from IC");
          addNotification("Source removed locally but IC sync failed", "error");
        });
    } else if (isAuthRef.current) {
      pendingDeletesRef.current.add(id);
      addNotification("Source removed locally — IC sync pending", "info");
    }
  }, [persist, isDemoMode]);

  const toggleSource = useCallback((id: string) => {
    if (isDemoMode) return;
    let toggled: SavedSource | undefined;
    setSources(prev => {
      const next = prev.map(s => {
        if (s.id !== id) return s;
        const updated = { ...s, enabled: !s.enabled };
        toggled = updated;
        return updated;
      });
      persist(next);
      return next;
    });
    // Reset error state when re-enabling a source
    queueMicrotask(() => {
      if (toggled) {
        saveToIC(toggled);
        if (toggled.enabled) {
          const config: Record<string, string> = {};
          if (toggled.feedUrl) config.feedUrl = toggled.feedUrl;
          if (toggled.relays) config.relays = toggled.relays.join(",");
          resetSourceErrors(getSourceKey(toggled.type, config));
        }
      }
    });
  }, [persist, isDemoMode]);

  const updateSource = useCallback((id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => {
    if (isDemoMode) return;
    let updated: SavedSource | undefined;
    setSources(prev => {
      const next = prev.map(s => {
        if (s.id !== id) return s;
        const merged = { ...s, ...partial };
        updated = merged;
        return merged;
      });
      persist(next);
      return next;
    });
    queueMicrotask(() => { if (updated) saveToIC(updated); });
  }, [persist, isDemoMode]);

  const getSchedulerSources = useCallback((): Array<{ type: "rss" | "url" | "nostr" | "farcaster"; config: Record<string, string>; enabled: boolean; platform?: import("@/lib/types/sources").SourcePlatform }> => {
    const result: Array<{ type: "rss" | "url" | "nostr" | "farcaster"; config: Record<string, string>; enabled: boolean; platform?: import("@/lib/types/sources").SourcePlatform }> = [];
    for (const s of sources) {
      if (!s.enabled) continue;
      if (s.type === "rss" && s.feedUrl) {
        result.push({ type: "rss", config: { feedUrl: s.feedUrl }, enabled: true, platform: s.platform });
      } else if (s.type === "nostr") {
        result.push({
          type: "nostr",
          config: {
            relays: (s.relays || []).join(","),
            pubkeys: (s.pubkeys || []).join(","),
          },
          enabled: true,
        });
      } else if (s.type === "farcaster" && s.fid) {
        result.push({
          type: "farcaster",
          config: { fid: String(s.fid), username: s.username || "" },
          enabled: true,
          platform: "farcaster",
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
  if (s.fid) config.fid = s.fid;
  if (s.username) config.username = s.username;
  if (s.platform) config.platform = s.platform;
  return {
    id: s.id,
    owner,
    sourceType: s.type,
    configJson: JSON.stringify({ label: s.label, ...config }),
    enabled: s.enabled,
    createdAt: BigInt(s.createdAt) * BigInt(1_000_000),
  };
}

function icToSaved(ic: SourceConfigEntry): SavedSource | null {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(ic.configJson); } catch (err) {
    console.warn(`[sources] Corrupted configJson for source ${ic.id}, skipping:`, err);
    return null;
  }
  if (ic.sourceType !== "rss" && ic.sourceType !== "nostr" && ic.sourceType !== "farcaster") {
    console.warn(`[sources] Unknown sourceType "${ic.sourceType}" for source ${ic.id}, skipping`);
    return null;
  }
  const label = typeof parsed.label === "string" ? parsed.label : ic.sourceType;
  const feedUrl = typeof parsed.feedUrl === "string" ? parsed.feedUrl : undefined;
  const relays = Array.isArray(parsed.relays) && parsed.relays.every((r: unknown) => typeof r === "string")
    ? (parsed.relays as string[]) : undefined;
  const pubkeys = Array.isArray(parsed.pubkeys) && parsed.pubkeys.every((p: unknown) => typeof p === "string")
    ? (parsed.pubkeys as string[]) : undefined;
  const fid = typeof parsed.fid === "number" ? parsed.fid : undefined;
  const username = typeof parsed.username === "string" ? parsed.username : undefined;
  const platform = typeof parsed.platform === "string" && SOURCE_PLATFORMS.has(parsed.platform)
    ? parsed.platform as SavedSource["platform"] : undefined;
  const createdAt = Number(ic.createdAt) / 1_000_000;

  return {
    id: ic.id,
    type: ic.sourceType as SavedSource["type"],
    platform,
    label,
    enabled: ic.enabled,
    feedUrl,
    relays,
    pubkeys,
    fid,
    username,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}
