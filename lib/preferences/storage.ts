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

/**
 * Sync preference profile to IC canister (fire-and-forget).
 * Dynamic imports avoid pulling @dfinity/agent into test bundles.
 */
export async function syncPreferencesToIC(
  identity: import("@dfinity/agent").Identity,
  profile: UserPreferenceProfile,
): Promise<boolean> {
  try {
    const { createBackendActorAsync } = await import("@/lib/ic/actor");
    const backend = await createBackendActorAsync(identity);
    return await backend.saveUserPreferences(
      JSON.stringify(profile),
      BigInt(profile.lastUpdated),
    );
  } catch (err) {
    console.warn("[prefs] IC sync failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Load preference profile from IC canister.
 * Returns deserialized profile or null if none stored / on error.
 */
export async function loadPreferencesFromIC(
  identity: import("@dfinity/agent").Identity,
  principalText: string,
): Promise<UserPreferenceProfile | null> {
  try {
    const { createBackendActorAsync } = await import("@/lib/ic/actor");
    const { Principal } = await import("@dfinity/principal");
    const backend = await createBackendActorAsync(identity);
    const result = await backend.getUserPreferences(Principal.fromText(principalText));

    if (result.length === 0) return null;

    const parsed = JSON.parse(result[0].preferencesJson);
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.topicAffinities !== "object" ||
      typeof parsed.authorTrust !== "object" ||
      !parsed.calibration ||
      typeof parsed.calibration.qualityThreshold !== "number" ||
      !Array.isArray(parsed.recentTopics)
    ) {
      console.warn("[prefs] IC preference data failed validation");
      return null;
    }

    parsed.principalId = principalText;
    return parsed as UserPreferenceProfile;
  } catch (err) {
    console.warn("[prefs] IC load failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Merge IC profile with local profile.
 * IC wins if newer or if local is empty (new device scenario).
 */
export function mergeProfiles(
  local: UserPreferenceProfile,
  ic: UserPreferenceProfile,
): UserPreferenceProfile {
  const localIsEmpty = local.totalValidated === 0
    && local.totalFlagged === 0
    && Object.keys(local.topicAffinities).length === 0;

  if (localIsEmpty || ic.lastUpdated > local.lastUpdated) {
    return { ...ic, principalId: local.principalId };
  }
  return local;
}
