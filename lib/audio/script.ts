// Title (<=80) → pause → body (500-char cap keeps 5 tracks under ~5min at 1.0x).
// Uses cached `item.translation` when preferTranslated; never triggers translation.
// Empty tracks dropped so the player never stalls on silence.

import type { ContentItem } from "@/lib/types/content";
import type { TranslationLanguage } from "@/lib/translation/types";
import type { AudioTrack, AudioPrefs, TrackSource } from "./types";
import { chunkText } from "./chunker";
import { detectLanguage } from "@/lib/ingestion/langDetect";

const TITLE_MAX_CHARS = 80;
const BODY_MAX_CHARS = 500;

/** Pause-marker inserted between title and body. Renders as a brief silence. */
const TITLE_BODY_SEPARATOR = " — ";

function pickSpokenText(item: ContentItem, prefs: AudioPrefs): { text: string; lang: TranslationLanguage } {
  if (prefs.preferTranslated && item.translation?.translatedText) {
    return {
      text: item.translation.translatedText,
      lang: item.translation.targetLanguage as TranslationLanguage,
    };
  }
  // detectLanguage may return "unknown"; fall back to English for audio purposes.
  const detected = detectLanguage(item.text);
  return { text: item.text, lang: detected === "ja" ? "ja" : "en" };
}

function buildTitle(text: string): string {
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length === 0) return "";
  if (firstLine.length <= TITLE_MAX_CHARS) return firstLine;
  // Truncate at the last word boundary before the limit so we don't cut
  // mid-word, then append an ellipsis to signal truncation to the listener.
  const slice = firstLine.slice(0, TITLE_MAX_CHARS);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > TITLE_MAX_CHARS / 2 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

function buildBody(text: string): string {
  const lines = text.split(/\r?\n/);
  // Drop the first line if we already used it as the title; otherwise the
  // listener hears the title twice.
  const body = (lines.length > 1 ? lines.slice(1).join(" ") : text).trim();
  if (body.length === 0) return "";
  if (body.length <= BODY_MAX_CHARS) return body;
  const slice = body.slice(0, BODY_MAX_CHARS);
  const lastSentence = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("。"),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("？"),
  );
  const cut = lastSentence > BODY_MAX_CHARS / 2 ? slice.slice(0, lastSentence + 1) : slice;
  return `${cut}…`;
}

function buildTrack(source: TrackSource, prefs: AudioPrefs): AudioTrack | null {
  const { text, lang: detected } = pickSpokenText(source.item, prefs);
  const title = buildTitle(text);
  const body = buildBody(text);
  const lang = source.lang ?? detected;

  const spoken = [title, body].filter(s => s.length > 0).join(TITLE_BODY_SEPARATOR);
  if (spoken.length === 0) return null;

  const chunks = chunkText(spoken);
  if (chunks.length === 0) return null;

  const totalChars = chunks.reduce((n, c) => n + c.length, 0);

  return {
    id: source.item.id,
    title: title || source.item.author,
    author: source.item.author,
    lang,
    chunks,
    totalChars,
    isSerendipity: source.isSerendipity,
  };
}

export function buildTracks(
  sources: ReadonlyArray<TrackSource>,
  prefs: AudioPrefs,
): AudioTrack[] {
  const tracks: AudioTrack[] = [];
  for (const src of sources) {
    const track = buildTrack(src, prefs);
    if (track !== null) tracks.push(track);
  }
  return tracks;
}
