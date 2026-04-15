/**
 * Validated localStorage helper.
 *
 * Eight or so modules implement near-identical localStorage validation:
 * JSON.parse the stored string, run a per-module guard predicate, fall back
 * to a default on shape mismatch, and survive Safari private-mode quota
 * errors. This helper centralizes those concerns; per-domain validators
 * live in the caller as a `guard` function.
 *
 * Quota policy: when setItem throws QuotaExceededError, the caller's value
 * is retained as-is — the helper does not silently truncate. A caller that
 * wants halve-and-retry behavior (e.g. translation cache) layers it above.
 */

export type Guard<T> = (value: unknown) => value is T;

function hasLocalStorage(): boolean {
  return typeof globalThis.localStorage !== "undefined";
}

/**
 * Read+validate a JSON-serialised value from localStorage.
 * Returns the fallback when:
 *  - localStorage is unavailable (SSR / privacy mode without storage)
 *  - the key is missing
 *  - the stored value is not valid JSON
 *  - the parsed value fails the guard predicate
 *
 * Important: returns the fallback BY REFERENCE — callers wanting an
 * independent copy must clone (e.g. `{...fallback}`).
 */
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

/**
 * Write a value to localStorage as JSON. Returns true on success, false on
 * any failure (storage unavailable, quota exceeded, security exception).
 * Does NOT throw.
 */
export function setValidated<T>(key: string, value: T): boolean {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Remove a key. No-op when localStorage is unavailable. */
export function removeValidated(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* private-mode SecurityError — drop */
  }
}
