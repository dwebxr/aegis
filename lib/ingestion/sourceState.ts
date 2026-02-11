/**
 * Source runtime state management with localStorage persistence.
 * Tracks error counts, backoff timing, adaptive intervals, and stats per source.
 */

const STORAGE_KEY = "aegis_source_states";

export interface SourceRuntimeState {
  errorCount: number;
  lastErrorAt: number;
  lastError: string;
  lastSuccessAt: number;
  lastFetchedAt: number;
  itemsFetched: number;
  consecutiveEmpty: number;
  nextFetchAt: number;
  averageScore: number;
  totalItemsScored: number;
}

export type SourceHealth = "healthy" | "degraded" | "error" | "disabled";

export const BACKOFF_MS = [60_000, 300_000, 1_200_000, 3_600_000] as const;
export const MAX_CONSECUTIVE_FAILURES = 5;

export const BASE_CYCLE_MS = 2 * 60 * 1000;
const MAX_INTERVAL_MS = 2 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 20 * 60 * 1000;

export function defaultState(): SourceRuntimeState {
  return {
    errorCount: 0,
    lastErrorAt: 0,
    lastError: "",
    lastSuccessAt: 0,
    lastFetchedAt: 0,
    itemsFetched: 0,
    consecutiveEmpty: 0,
    nextFetchAt: 0,
    averageScore: 0,
    totalItemsScored: 0,
  };
}

export function getSourceKey(type: string, config: Record<string, string>): string {
  switch (type) {
    case "rss":
      return `rss:${config.feedUrl || "unknown"}`;
    case "nostr":
      return `nostr:${config.relays || "unknown"}`;
    case "url":
      return `url:${config.url || "unknown"}`;
    default:
      return `${type}:unknown`;
  }
}

function isValidState(v: unknown): v is SourceRuntimeState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.errorCount === "number" &&
    typeof s.nextFetchAt === "number" &&
    typeof s.averageScore === "number"
  );
}

export function loadSourceStates(): Record<string, SourceRuntimeState> {
  if (typeof globalThis.localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const result: Record<string, SourceRuntimeState> = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = isValidState(value) ? value : defaultState();
    }
    return result;
  } catch (err) {
    console.warn("[sourceState] Corrupted localStorage data, resetting:", err);
    return {};
  }
}

export function saveSourceStates(states: Record<string, SourceRuntimeState>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch (err) {
    console.warn("[sourceState] Failed to persist source states:", err);
  }
}

export function computeBackoffDelay(errorCount: number): number {
  if (errorCount <= 0) return 0;
  const idx = Math.min(errorCount - 1, BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

export function computeAdaptiveInterval(state: SourceRuntimeState): number {
  // Consecutive empty fetches → slow down
  if (state.consecutiveEmpty >= 3) {
    return Math.min(DEFAULT_INTERVAL_MS * 2, MAX_INTERVAL_MS);
  }
  // Active source (fetched ≥5 items last cycle) → speed up
  if (state.itemsFetched >= 5) {
    return Math.max(DEFAULT_INTERVAL_MS / 2, MIN_INTERVAL_MS);
  }
  return DEFAULT_INTERVAL_MS;
}

export function getSourceHealth(state: SourceRuntimeState): SourceHealth {
  if (state.errorCount >= MAX_CONSECUTIVE_FAILURES) return "disabled";
  if (state.errorCount >= 3) return "error";
  if (state.errorCount >= 1) return "degraded";
  return "healthy";
}
