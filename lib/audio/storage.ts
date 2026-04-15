/**
 * Audio briefing player preferences (localStorage).
 *
 * Mirrors the storage convention used by `lib/webllm/storage.ts` and
 * `lib/mediapipe/storage.ts`: a single JSON-serialised key per concern, with
 * the value validated on read so that older / corrupted data is replaced
 * with defaults rather than crashing the app.
 */

import type { AudioPrefs } from "./types";
import { DEFAULT_AUDIO_PREFS } from "./types";
import { getValidated, setValidated } from "@/lib/utils/validatedLocalStorage";

const STORAGE_KEY = "aegis-audio-prefs";

function isValidPrefs(value: unknown): value is AudioPrefs {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.enabled !== "boolean") return false;
  if (typeof v.rate !== "number" || !Number.isFinite(v.rate)) return false;
  if (v.rate < 0.5 || v.rate > 2.0) return false;
  if (v.voiceURI !== undefined && typeof v.voiceURI !== "string") return false;
  if (typeof v.preferTranslated !== "boolean") return false;
  if (typeof v.includeSerendipity !== "boolean") return false;
  return true;
}

export function getAudioPrefs(): AudioPrefs {
  const stored = getValidated(STORAGE_KEY, isValidPrefs, DEFAULT_AUDIO_PREFS);
  // Always return an independent object so callers can safely mutate.
  return stored === DEFAULT_AUDIO_PREFS ? { ...DEFAULT_AUDIO_PREFS } : stored;
}

export function updateAudioPrefs(patch: Partial<AudioPrefs>): AudioPrefs {
  const next = { ...getAudioPrefs(), ...patch };
  setValidated(STORAGE_KEY, next);
  return next;
}
