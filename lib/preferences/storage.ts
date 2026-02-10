import type { UserPreferenceProfile } from "./types";
import { createEmptyProfile } from "./types";

const KEY_PREFIX = "aegis_prefs_";

export function loadProfile(principalId: string): UserPreferenceProfile {
  if (typeof window === "undefined") return createEmptyProfile(principalId);
  try {
    const raw = localStorage.getItem(KEY_PREFIX + principalId);
    if (!raw) return createEmptyProfile(principalId);
    const parsed = JSON.parse(raw) as UserPreferenceProfile;
    if (parsed.version !== 1 || parsed.principalId !== principalId) {
      return createEmptyProfile(principalId);
    }
    return parsed;
  } catch (err) {
    console.warn("[prefs] Failed to load preference profile:", err);
    return createEmptyProfile(principalId);
  }
}

export function saveProfile(profile: UserPreferenceProfile): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(KEY_PREFIX + profile.principalId, JSON.stringify(profile));
    return true;
  } catch (err) {
    console.warn("[prefs] Failed to save preference profile (localStorage may be full):", err);
    return false;
  }
}
