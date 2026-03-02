import type { UserPreferenceProfile } from "./types";
import { createEmptyProfile } from "./types";
import { errMsg } from "@/lib/utils/errors";

const KEY_PREFIX = "aegis_prefs_";

/** Validate parsed JSON is a structurally valid UserPreferenceProfile. */
export function isValidProfile(parsed: unknown): parsed is UserPreferenceProfile {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const p = parsed as Record<string, unknown>;
  if (p.version !== 1 || typeof p.principalId !== "string") return false;

  // topicAffinities: Record<string, number>
  if (typeof p.topicAffinities !== "object" || p.topicAffinities === null || Array.isArray(p.topicAffinities)) return false;
  for (const v of Object.values(p.topicAffinities as Record<string, unknown>)) {
    if (typeof v !== "number") return false;
  }

  // authorTrust: Record<string, AuthorTrust>
  if (typeof p.authorTrust !== "object" || p.authorTrust === null || Array.isArray(p.authorTrust)) return false;
  for (const v of Object.values(p.authorTrust as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const at = v as Record<string, unknown>;
    if (typeof at.validates !== "number" || typeof at.flags !== "number" || typeof at.trust !== "number") return false;
  }

  // calibration
  if (!p.calibration || typeof p.calibration !== "object" || Array.isArray(p.calibration)) return false;
  if (typeof (p.calibration as Record<string, unknown>).qualityThreshold !== "number") return false;

  // recentTopics: RecentTopic[]
  if (!Array.isArray(p.recentTopics)) return false;
  for (const rt of p.recentTopics as unknown[]) {
    if (!rt || typeof rt !== "object") return false;
    const r = rt as Record<string, unknown>;
    if (typeof r.topic !== "string" || typeof r.timestamp !== "number") return false;
  }

  if (typeof p.totalValidated !== "number" || typeof p.totalFlagged !== "number") return false;
  if (typeof p.lastUpdated !== "number") return false;

  // Optional: customFilterRules
  if (p.customFilterRules !== undefined) {
    if (!Array.isArray(p.customFilterRules)) return false;
    for (const r of p.customFilterRules as unknown[]) {
      if (!r || typeof r !== "object") return false;
      const rule = r as Record<string, unknown>;
      if (typeof rule.id !== "string" || typeof rule.pattern !== "string") return false;
      if (!["author", "title"].includes(rule.field as string)) return false;
      if (typeof rule.createdAt !== "number") return false;
    }
  }

  // Optional: activityHistogram
  if (p.activityHistogram !== undefined) {
    const ah = p.activityHistogram as Record<string, unknown>;
    if (!Array.isArray(ah.hourCounts) || (ah.hourCounts as unknown[]).length !== 24) return false;
    for (const c of ah.hourCounts as unknown[]) {
      if (typeof c !== "number") return false;
    }
    if (typeof ah.lastActivityAt !== "number" || typeof ah.totalEvents !== "number") return false;
  }

  return true;
}

export function loadProfile(principalId: string): UserPreferenceProfile {
  if (typeof window === "undefined") return createEmptyProfile(principalId);
  try {
    const raw = localStorage.getItem(KEY_PREFIX + principalId);
    if (!raw) return createEmptyProfile(principalId);
    const parsed = JSON.parse(raw);
    if (!isValidProfile(parsed) || parsed.principalId !== principalId) {
      console.warn("[prefs] Stored profile failed validation for", principalId.slice(0, 12), "— resetting to empty");
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
      BigInt(Math.round(profile.lastUpdated)),
    );
  } catch (err) {
    console.warn("[prefs] IC sync failed:", errMsg(err));
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
    // Set principalId before validation so isValidProfile can check it
    if (parsed && typeof parsed === "object") parsed.principalId = principalText;
    if (!isValidProfile(parsed)) {
      console.warn("[prefs] IC preference data failed validation");
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn("[prefs] IC load failed:", errMsg(err));
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
