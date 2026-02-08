import type { UserPreferenceProfile } from "./types";
import { createEmptyProfile } from "./types";

const STORAGE_KEY_PREFIX = "aegis_prefs_";

function storageKey(principalId: string): string {
  return `${STORAGE_KEY_PREFIX}${principalId}`;
}

export function loadProfile(principalId: string): UserPreferenceProfile {
  if (typeof window === "undefined") return createEmptyProfile(principalId);
  try {
    const raw = localStorage.getItem(storageKey(principalId));
    if (!raw) return createEmptyProfile(principalId);
    const parsed = JSON.parse(raw) as UserPreferenceProfile;
    if (parsed.version !== 1 || parsed.principalId !== principalId) {
      return createEmptyProfile(principalId);
    }
    return parsed;
  } catch (err) {
    console.warn("Failed to load preference profile:", err);
    return createEmptyProfile(principalId);
  }
}

export function saveProfile(profile: UserPreferenceProfile): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(storageKey(profile.principalId), JSON.stringify(profile));
    return true;
  } catch (err) {
    console.warn("Failed to save preference profile (localStorage may be full):", err);
    return false;
  }
}
