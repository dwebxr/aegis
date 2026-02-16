import type { UserPreferenceProfile } from "./types";
import { createEmptyProfile } from "./types";

const KEY_PREFIX = "aegis_prefs_";

export function loadProfile(principalId: string): UserPreferenceProfile {
  if (typeof window === "undefined") return createEmptyProfile(principalId);
  try {
    const raw = localStorage.getItem(KEY_PREFIX + principalId);
    if (!raw) return createEmptyProfile(principalId);
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.version !== 1 ||
      parsed.principalId !== principalId ||
      typeof parsed.topicAffinities !== "object" ||
      typeof parsed.authorTrust !== "object" ||
      !parsed.calibration ||
      typeof parsed.calibration.qualityThreshold !== "number" ||
      !Array.isArray(parsed.recentTopics)
    ) {
      return createEmptyProfile(principalId);
    }
    return parsed as UserPreferenceProfile;
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
    console.warn("[prefs] Failed to save preference profile:", err);
    return false;
  }
}
