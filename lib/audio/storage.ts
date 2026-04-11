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
  if (typeof globalThis.localStorage === "undefined") return { ...DEFAULT_AUDIO_PREFS };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_AUDIO_PREFS };
  try {
    const parsed = JSON.parse(raw);
    if (!isValidPrefs(parsed)) return { ...DEFAULT_AUDIO_PREFS };
    return parsed;
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

export function setAudioPrefs(prefs: AudioPrefs): void {
  if (typeof globalThis.localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function updateAudioPrefs(patch: Partial<AudioPrefs>): AudioPrefs {
  const next = { ...getAudioPrefs(), ...patch };
  setAudioPrefs(next);
  return next;
}
