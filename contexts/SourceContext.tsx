"use client";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useCurrentRef } from "@/hooks/useCurrentRef";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./AuthContext";
import { useDemo } from "./DemoContext";
import { DEMO_SOURCES } from "@/lib/demo/sources";
import { useNotify } from "./NotificationContext";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { loadSources, saveSources, inferPlatform, loadPendingDeletes, savePendingDeletes } from "@/lib/sources/storage";
import type { SavedSource } from "@/lib/types/sources";
import { SOURCE_PLATFORMS } from "@/lib/types/sources";
import type { _SERVICE, SourceConfigEntry } from "@/lib/ic/declarations";
import { errMsg, errMsgShort, handleICSessionError } from "@/lib/utils/errors";
import { getSourceKey, resetSourceErrors } from "@/lib/ingestion/sourceState";
import type { SchedulerSource } from "@/lib/ingestion/scheduler";

export type { SchedulerSource };

/** Content identity key: rss:{feedUrl}, nostr:{sorted relays}, fc:{fid}. */
function contentKey(s: SavedSource): string {
  if (s.type === "rss") return `rss:${s.feedUrl || s.id}`;
  if (s.type === "nostr") return `nostr:${(s.relays || []).slice().sort().join(",")}`;
  if (s.type === "farcaster") return `fc:${s.fid || s.id}`;
  return `unknown:${s.id}`;
}

function isContentKey(entry: string): boolean {
  return entry.startsWith("rss:") || entry.startsWith("nostr:") || entry.startsWith("fc:") || entry.startsWith("unknown:");
}

/** Deduplicate sources by content identity. Keeps the first occurrence. */
function dedup(sources: SavedSource[]): SavedSource[] {
  const seen = new Set<string>();
  return sources.filter(s => {
    const key = contentKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDeletePending(s: SavedSource, pending: Set<string>): boolean {
  return pending.has(s.id) || pending.has(contentKey(s));
}

interface SourceState {
  sources: SavedSource[];
  syncStatus: "idle" | "syncing" | "synced" | "error";
  syncError: string;
  addSource: (source: Omit<SavedSource, "id" | "createdAt">) => boolean;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;
  updateSource: (id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => void;
  getSchedulerSources: () => SchedulerSource[];
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

function buildSourceConfig(s: SavedSource): Record<string, string> {
  const config: Record<string, string> = {};
  if (s.feedUrl) config.feedUrl = s.feedUrl;
  if (s.relays) config.relays = s.relays.join(",");
  if (s.fid) config.fid = String(s.fid);
  if (s.username) config.username = s.username;
  return config;
}

export function SourceProvider({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotify();
  const { isAuthenticated, identity, principalText } = useAuth();
  const { isDemoMode } = useDemo();
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const actorRef = useRef<_SERVICE | null>(null);
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const sourcesRef = useCurrentRef(sources);
  const identityRef = useCurrentRef(identity);
  const isAuthRef = useCurrentRef(isAuthenticated);
  const principalTextRef = useCurrentRef(principalText);

  function getActor(): _SERVICE | null {
    if (!isAuthRef.current || !identityRef.current) return null;
    return actorRef.current;
  }

  const saveToIC = useCallback((source: SavedSource): void => {
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
  }, [addNotification]);

  useEffect(() => {
    if (!isAuthenticated || !identity || !principalText) {
      actorRef.current = null;
      setSources([]);
      setSyncStatus("idle");
      setSyncError("");
      return;
    }

    let cancelled = false;
    const pendingDeletes = pendingDeletesRef.current;

    // Restore pending deletes from localStorage so deletions survive tab close
    for (const id of loadPendingDeletes(principalText)) pendingDeletes.add(id);

    setSources(dedup(loadSources(principalText).filter(s => !isDeletePending(s, pendingDeletes))));

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

        // Flush pending deletes (only real IDs, not content keys)
        if (pendingDeletes.size > 0) {
          const idsToDelete = Array.from(pendingDeletes).filter(e => !isContentKey(e));
          if (idsToDelete.length > 0) {
            const results = await Promise.allSettled(
              idsToDelete.map(id => actor.deleteSourceConfig(id))
            );
            if (cancelled) return;
            results.forEach((res, idx) => {
              if (res.status === "fulfilled") pendingDeletes.delete(idsToDelete[idx]);
              else console.warn("[sources] pending delete failed:", idsToDelete[idx], errMsg(res.reason));
            });
          }
        }

        const icConfigs = await actor.getUserSourceConfigs(principal);
        if (cancelled) return;

        const allIcSources = icConfigs.map(icToSaved).filter((s): s is SavedSource => s !== null);
        const icSources = dedup(allIcSources.filter(s => !isDeletePending(s, pendingDeletes)));

        // Clean up stale content keys (no longer present on IC)
        const icContentKeys = new Set(allIcSources.map(contentKey));
        for (const entry of pendingDeletes) {
          if (isContentKey(entry) && !icContentKeys.has(entry)) pendingDeletes.delete(entry);
        }
        savePendingDeletes(principalText, pendingDeletes);

        // Compute localOnly from ref (always latest committed state) to avoid
        // React 18 batching issues where setSources updater runs after this scope
        const currentSources = sourcesRef.current;
        const icIds = new Set(icSources.map(s => s.id));
        const localById = new Map(currentSources.map(s => [s.id, s]));
        const localOnly = currentSources.filter(s => !icIds.has(s.id) && !isDeletePending(s, pendingDeletes));
        for (const ic of icSources) {
          if (!ic.platform) {
            ic.platform = localById.get(ic.id)?.platform || inferPlatform(ic);
          }
        }
        const merged = [...icSources, ...localOnly];
        saveSources(principalText, merged);
        setSources(merged);
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
        console.error("[sources] IC query failed:", errMsg(err));
        setSyncStatus("error");
        setSyncError(errMsg(err));
        addNotification(`IC sync unavailable — ${errMsgShort(err)}`, "error");
      }
    };
    doSync().catch(err => {
      if (!cancelled) console.error("[sources] Unhandled doSync error:", errMsg(err));
    });

    return () => { cancelled = true; };
  }, [isAuthenticated, identity, principalText, addNotification]);

  useEffect(() => {
    if (isDemoMode) setSources(DEMO_SOURCES);
  }, [isDemoMode]);

  const persist = useCallback((next: SavedSource[]) => {
    const pt = principalTextRef.current;
    if (pt) saveSources(pt, next);
  }, []);

  const addSource = useCallback((partial: Omit<SavedSource, "id" | "createdAt">): boolean => {
    if (isDemoMode) return false;
    const candidate = { ...partial, id: "", createdAt: 0 } as SavedSource;
    const ck = contentKey(candidate);
    if (sourcesRef.current.some(s => contentKey(s) === ck)) return false;

    const source: SavedSource = { ...partial, id: uuidv4(), createdAt: Date.now() };
    // Clear any pending delete for this content key so re-added sources aren't filtered
    if (pendingDeletesRef.current.has(ck)) {
      pendingDeletesRef.current.delete(ck);
      const pt = principalTextRef.current;
      if (pt) savePendingDeletes(pt, pendingDeletesRef.current);
    }
    setSources(prev => {
      const next = [...prev, source];
      persist(next);
      return next;
    });
    saveToIC(source);
    return true;
  }, [persist, isDemoMode, saveToIC]);

  const removeSource = useCallback((id: string) => {
    if (isDemoMode) return;
    const toRemove = sourcesRef.current.find(s => s.id === id);
    if (toRemove) {
      resetSourceErrors(getSourceKey(toRemove.type, buildSourceConfig(toRemove)));
    }
    setSources(prev => {
      const next = prev.filter(s => s.id !== id);
      persist(next);
      return next;
    });
    // Track deletion by both ID and content key so IC sources with different IDs are also caught
    pendingDeletesRef.current.add(id);
    if (toRemove) pendingDeletesRef.current.add(contentKey(toRemove));
    const pt = principalTextRef.current;
    if (pt) savePendingDeletes(pt, pendingDeletesRef.current);

    const actor = getActor();
    if (actor) {
      actor.deleteSourceConfig(id)
        .then(() => {
          pendingDeletesRef.current.delete(id);
          if (pt) savePendingDeletes(pt, pendingDeletesRef.current);
        })
        .catch((err: unknown) => {
          console.error("[sources] IC delete failed:", errMsg(err));
          setSyncStatus("error");
          setSyncError("Failed to delete source from IC");
          addNotification("Source removed locally but IC sync failed", "error");
        });
    } else if (isAuthRef.current) {
      addNotification("Source removed locally — IC sync pending", "info");
    }
  }, [persist, isDemoMode, addNotification]);

  const toggleSource = useCallback((id: string) => {
    if (isDemoMode) return;
    // Compute toggled from ref to avoid React 18 batching issues with setSources updater
    const current = sourcesRef.current.find(s => s.id === id);
    if (!current) return;
    const toggled = { ...current, enabled: !current.enabled };
    setSources(prev => {
      const next = prev.map(s => s.id === id ? toggled : s);
      persist(next);
      return next;
    });
    saveToIC(toggled);
    if (toggled.enabled) {
      resetSourceErrors(getSourceKey(toggled.type, buildSourceConfig(toggled)));
    }
  }, [persist, isDemoMode, saveToIC]);

  const updateSource = useCallback((id: string, partial: Partial<Pick<SavedSource, "label" | "feedUrl" | "relays" | "pubkeys">>) => {
    if (isDemoMode) return;
    const current = sourcesRef.current.find(s => s.id === id);
    if (!current) return;
    const updated = { ...current, ...partial };
    setSources(prev => {
      const next = prev.map(s => s.id === id ? updated : s);
      persist(next);
      return next;
    });
    saveToIC(updated);
  }, [persist, isDemoMode, saveToIC]);

  const getSchedulerSources = useCallback((): SchedulerSource[] => {
    const result: SchedulerSource[] = [];
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
    createdAt: BigInt(Math.round(s.createdAt)) * BigInt(1_000_000),
  };
}

function icToSaved(ic: SourceConfigEntry): SavedSource | null {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(ic.configJson); } catch (err) {
    console.warn(`[sources] Corrupted configJson for source ${ic.id}, skipping:`, errMsg(err));
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
