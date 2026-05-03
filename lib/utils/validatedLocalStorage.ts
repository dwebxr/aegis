// Quota policy: setValidated returns false on QuotaExceededError; callers wanting
// halve-and-retry (e.g. translation cache) layer it on top.

export type Guard<T> = (value: unknown) => value is T;

function hasLocalStorage(): boolean {
  return typeof globalThis.localStorage !== "undefined";
}

// Returns fallback BY REFERENCE — callers needing an independent copy must clone.
export function getValidated<T>(key: string, guard: Guard<T>, fallback: T): T {
  if (!hasLocalStorage()) return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!guard(parsed)) return fallback;
  return parsed;
}

// Returns false on any failure (unavailable / quota / security); never throws.
export function setValidated<T>(key: string, value: T): boolean {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeValidated(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Safari private-mode SecurityError — drop
  }
}
