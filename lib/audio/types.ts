// Backend-agnostic types so a future BYOK TTS (OpenAI/ElevenLabs) can slot in.

import type { ContentItem } from "@/lib/types/content";
import type { TranslationLanguage } from "@/lib/translation/types";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

// Chunked because iOS Safari silently fails to fire onend for utterances over ~150 chars.
export interface AudioTrack {
  id: string;
  title: string;
  author: string;
  lang: TranslationLanguage;
  chunks: ReadonlyArray<string>;
  totalChars: number;
  isSerendipity: boolean;
}

export interface PlayerStatusSnapshot {
  status: PlayerStatus;
  trackIndex: number;
  trackCount: number;
  chunkIndex: number;
  currentTrack: AudioTrack | null;
  rate: number;
  error: string | null;
}

export interface AudioPrefs {
  enabled: boolean;
  rate: number;
  // Engine picks the best voice for the track lang when undefined.
  voiceURI?: string;
  // Reads cached translation when present; never auto-translates (no extra IC/Claude calls).
  preferTranslated: boolean;
  includeSerendipity: boolean;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  enabled: true,
  rate: 1.0,
  voiceURI: undefined,
  preferTranslated: true,
  includeSerendipity: true,
};

export interface TrackSource {
  item: ContentItem;
  isSerendipity: boolean;
  // Falls back to translation.targetLanguage, then a heuristic on the original text.
  lang?: TranslationLanguage;
}
