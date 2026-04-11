/**
 * Types for the audio briefing player.
 *
 * Phase 1 only ships the Web Speech (browser-local SpeechSynthesis) backend,
 * but the type surface is named generically so a future BYOK TTS backend
 * (OpenAI / ElevenLabs) can be slotted in without breaking the engine,
 * hook, or UI contracts.
 */

import type { ContentItem } from "@/lib/types/content";
import type { TranslationLanguage } from "@/lib/translation/types";

/** Player lifecycle states. */
export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

/**
 * A single track corresponds to one BriefingItem (priority article or
 * serendipity pick). It is broken into a list of utterance-safe chunks so
 * that the Web Speech API behaves correctly on iOS Safari, which silently
 * fails to fire `onend` for utterances longer than ~150 characters.
 */
export interface AudioTrack {
  /** ContentItem.id — used for de-duplication and resume. */
  id: string;
  /** Display title (first line of the article text, trimmed). */
  title: string;
  /** Author handle. */
  author: string;
  /** Language hint passed to SpeechSynthesisUtterance.lang. */
  lang: TranslationLanguage;
  /** Ordered list of chunked utterances; concatenated == the spoken content. */
  chunks: ReadonlyArray<string>;
  /** Total length in characters across all chunks (used for time estimates). */
  totalChars: number;
  /** Whether this track is the serendipity pick (UI-only flag). */
  isSerendipity: boolean;
}

/**
 * Snapshot of the player at any moment. Subscribers (the React hook and
 * MediaSession integrator) treat this as immutable; the engine emits a new
 * snapshot on every state transition.
 */
export interface PlayerStatusSnapshot {
  status: PlayerStatus;
  /** Current track index in the active queue, or -1 when idle. */
  trackIndex: number;
  /** Total number of tracks in the active queue. */
  trackCount: number;
  /** Current chunk index within the active track. */
  chunkIndex: number;
  /** Active track (if any) — convenience for UI rendering. */
  currentTrack: AudioTrack | null;
  /** Speech rate currently in effect (mirrors AudioPrefs.rate). */
  rate: number;
  /** Last error message, only set when status === "error". */
  error: string | null;
}

/** User-tunable audio preferences (persisted to localStorage). */
export interface AudioPrefs {
  /** Master toggle. When false, the Listen button is hidden. */
  enabled: boolean;
  /** Speech rate (0.5–2.0). Forwarded to SpeechSynthesisUtterance.rate. */
  rate: number;
  /**
   * Optional voice URI (`SpeechSynthesisVoice.voiceURI`). When undefined the
   * engine picks the best voice for the track language at playback time.
   */
  voiceURI?: string;
  /**
   * When true, attempt to read the translated text instead of the original
   * if a translation is already cached. Auto-translation is NOT triggered:
   * audio playback only consumes existing translation cache to avoid extra
   * IC LLM / Claude calls during a "Listen" session.
   */
  preferTranslated: boolean;
  /** When true, append the serendipity item to the queue after the priority list. */
  includeSerendipity: boolean;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  enabled: true,
  rate: 1.0,
  voiceURI: undefined,
  preferTranslated: true,
  includeSerendipity: true,
};

/**
 * Source material for a track. The engine accepts an array of these
 * (priority items + optional serendipity) and runs them through the script
 * builder + chunker to produce playable AudioTracks.
 */
export interface TrackSource {
  item: ContentItem;
  isSerendipity: boolean;
  /**
   * Override language for this specific source. When omitted, the engine
   * derives the language from `item.translation?.targetLanguage` if a
   * translation will be used, otherwise from a heuristic on the original
   * text.
   */
  lang?: TranslationLanguage;
}
