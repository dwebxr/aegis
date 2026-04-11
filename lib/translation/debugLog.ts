/**
 * Persistent translation debug log.
 *
 * Captures the last N translation attempts (per-item per-backend) to
 * localStorage so the user can read them later from Settings →
 * Translation Engine without needing to open a browser console (which
 * is not feasible on a mobile PWA).
 *
 * Each log entry records: backend name, outcome (ok / skip / failed),
 * reason (if any), elapsed milliseconds, and timestamp. The log is
 * capped at 50 entries on a rolling basis.
 */

const STORAGE_KEY = "aegis-translation-debug-log";
const MAX_ENTRIES = 50;

export type TranslationDebugOutcome = "ok" | "skip" | "failed" | "transport-error";

export interface TranslationDebugEntry {
  /** ISO timestamp of when the attempt finished */
  timestamp: string;
  /** Item identifier (truncated content text or item id, first 60 chars) */
  itemHint: string;
  /** Target language code (e.g. "ja") */
  targetLanguage: string;
  /** Backend that was tried */
  backend: string;
  /** Result classification */
  outcome: TranslationDebugOutcome;
  /** Reason / error message (truncated to 300 chars) */
  reason: string;
  /** How long the attempt took, in milliseconds */
  elapsedMs: number;
}

function readLog(): TranslationDebugEntry[] {
  if (typeof globalThis.localStorage === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e: unknown): e is TranslationDebugEntry => {
      if (!e || typeof e !== "object") return false;
      const obj = e as Record<string, unknown>;
      return (
        typeof obj.timestamp === "string" &&
        typeof obj.backend === "string" &&
        typeof obj.outcome === "string" &&
        typeof obj.reason === "string" &&
        typeof obj.elapsedMs === "number"
      );
    });
  } catch {
    return [];
  }
}

function writeLog(entries: TranslationDebugEntry[]): void {
  if (typeof globalThis.localStorage === "undefined") return;
  const trimmed = entries.slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage quota exceeded — drop the oldest 25 entries and retry once
    const halved = trimmed.slice(-Math.floor(MAX_ENTRIES / 2));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(halved));
    } catch {
      // Give up — debug log is best-effort
    }
  }
}

export function recordTranslationAttempt(entry: Omit<TranslationDebugEntry, "timestamp">): void {
  const full: TranslationDebugEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
    reason: entry.reason.slice(0, 300),
    itemHint: entry.itemHint.slice(0, 60),
  };
  const log = readLog();
  log.push(full);
  writeLog(log);
}

export function getTranslationDebugLog(): TranslationDebugEntry[] {
  return readLog();
}

export function clearTranslationDebugLog(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Format the debug log as a single human-readable string the user can
 * copy from the Settings UI and paste back. Includes a header line so
 * we know which build produced the log.
 */
export function formatDebugLog(version?: string): string {
  const log = readLog();
  if (log.length === 0) {
    return `Aegis translation debug log (build ${version ?? "unknown"})\n\n(no entries yet)`;
  }
  const lines = [
    `Aegis translation debug log (build ${version ?? "unknown"})`,
    `Total entries: ${log.length}`,
    "",
  ];
  for (const e of log) {
    lines.push(
      `${e.timestamp} [${e.backend}] ${e.outcome} (${e.elapsedMs}ms) → ${e.targetLanguage}`,
    );
    lines.push(`  item: ${e.itemHint}`);
    if (e.reason) lines.push(`  reason: ${e.reason}`);
    lines.push("");
  }
  return lines.join("\n");
}
