/**
 * Web Speech API wrapper for the audio briefing player.
 *
 * Wraps `SpeechSynthesisUtterance` in a promise-based API so the engine can
 * `await speakChunk(...)` and chain utterances cleanly. Handles three quirks
 * the spec doesn't make obvious:
 *
 *   1. iOS Safari `onend` bug — utterances longer than ~150 chars never fire
 *      `onend`. The chunker keeps each utterance below that limit, but as a
 *      defence in depth this wrapper also installs a fallback timer derived
 *      from the chunk length so a missing `onend` does not stall the queue.
 *
 *   2. Voice list lazy loading — Chrome populates `getVoices()` asynchronously
 *      via `voiceschanged`. We expose `loadVoices()` which resolves once a
 *      non-empty voice list is available (or after a short timeout).
 *
 *   3. Cancellation — `speechSynthesis.cancel()` synchronously aborts the
 *      current utterance and rejects all pending `speakChunk` promises with
 *      a sentinel `CancelledError` so the engine can distinguish "user
 *      stopped playback" from "actual TTS failure".
 */

export class CancelledError extends Error {
  constructor() {
    super("audio playback cancelled");
    this.name = "CancelledError";
  }
}

export function isWebSpeechAvailable(): boolean {
  return typeof globalThis !== "undefined"
    && typeof (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis !== "undefined"
    && typeof (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance === "function";
}

let cachedVoices: SpeechSynthesisVoice[] | null = null;

/**
 * Resolve once `speechSynthesis.getVoices()` returns a non-empty list, or
 * after `timeoutMs` ms have elapsed (whichever happens first). Subsequent
 * calls return the cached list immediately.
 */
export async function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!isWebSpeechAvailable()) return [];
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;

  const synth = globalThis.speechSynthesis;
  const initial = synth.getVoices();
  if (initial.length > 0) {
    cachedVoices = initial;
    return initial;
  }

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      cachedVoices = voices;
      synth.removeEventListener("voiceschanged", onChange);
      resolve(voices);
    };
    const onChange = () => finish(synth.getVoices());
    synth.addEventListener("voiceschanged", onChange);
    setTimeout(() => finish(synth.getVoices()), timeoutMs);
  });
}

/**
 * Pick the best `SpeechSynthesisVoice` for `langCode` (BCP-47 prefix match).
 * Preference order:
 *   1. Voice explicitly identified by `voiceURI` (used for the user's
 *      Settings choice).
 *   2. A `localService` voice matching the language exactly.
 *   3. Any voice matching the language exactly.
 *   4. A voice whose `lang` starts with the requested prefix (e.g. "en"
 *      matching "en-US").
 *   5. The system default voice (or undefined if none exists).
 */
export function pickVoice(
  voices: ReadonlyArray<SpeechSynthesisVoice>,
  langCode: string,
  voiceURI?: string,
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;

  if (voiceURI) {
    const explicit = voices.find(v => v.voiceURI === voiceURI);
    if (explicit) return explicit;
  }

  const target = mapToBcp47(langCode);

  const exactLocal = voices.find(v => v.lang === target && v.localService);
  if (exactLocal) return exactLocal;

  const exactAny = voices.find(v => v.lang === target);
  if (exactAny) return exactAny;

  const prefix = target.slice(0, 2);
  const prefixLocal = voices.find(v => v.lang.toLowerCase().startsWith(prefix) && v.localService);
  if (prefixLocal) return prefixLocal;

  const prefixAny = voices.find(v => v.lang.toLowerCase().startsWith(prefix));
  if (prefixAny) return prefixAny;

  return voices.find(v => v.default) ?? voices[0];
}

/**
 * Map a TranslationLanguage code to a BCP-47 voice locale. The Web Speech
 * API uses locales like "en-US", "ja-JP" rather than bare ISO codes, so we
 * normalise here.
 */
function mapToBcp47(langCode: string): string {
  const lower = langCode.toLowerCase();
  switch (lower) {
    case "en": return "en-US";
    case "ja": return "ja-JP";
    case "zh": return "zh-CN";
    case "ko": return "ko-KR";
    case "es": return "es-ES";
    case "fr": return "fr-FR";
    case "de": return "de-DE";
    case "pt": return "pt-PT";
    case "it": return "it-IT";
    case "ru": return "ru-RU";
    default: return langCode;
  }
}

export interface SpeakChunkOptions {
  text: string;
  lang: string;
  rate: number;
  pitch?: number;
  voice?: SpeechSynthesisVoice;
  /**
   * Optional abort signal. When aborted, the in-flight utterance is
   * cancelled and the returned promise rejects with `CancelledError`.
   */
  signal?: AbortSignal;
}

/**
 * Speak a single chunk and resolve when the utterance ends. Rejects with
 * `CancelledError` if the abort signal fires, or with a regular Error for
 * any other failure surfaced by the synth engine.
 *
 * The fallback timer is `(text.length / 8) seconds + 2 seconds`, which is
 * generous enough to cover the slowest realistic speech rates while still
 * unblocking the queue if `onend` never fires.
 */
export function speakChunk(opts: SpeakChunkOptions): Promise<void> {
  if (!isWebSpeechAvailable()) {
    return Promise.reject(new Error("Web Speech API not available"));
  }
  if (opts.signal?.aborted) {
    return Promise.reject(new CancelledError());
  }

  return new Promise<void>((resolve, reject) => {
    const synth = globalThis.speechSynthesis;
    const utterance = new globalThis.SpeechSynthesisUtterance(opts.text);
    utterance.lang = mapToBcp47(opts.lang);
    utterance.rate = opts.rate;
    utterance.pitch = opts.pitch ?? 1.0;
    if (opts.voice) utterance.voice = opts.voice;

    let settled = false;
    const fallbackMs = Math.max(2000, Math.ceil(opts.text.length / 8) * 1000 + 2000);
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      utterance.onend = null;
      utterance.onerror = null;
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onError = (event: SpeechSynthesisErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      // "interrupted" / "canceled" mean cancel() was called externally —
      // surface that as CancelledError so the engine can ignore it.
      if (event.error === "interrupted" || event.error === "canceled") {
        reject(new CancelledError());
      } else {
        reject(new Error(`Web Speech error: ${event.error}`));
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      synth.cancel();
      reject(new CancelledError());
    };

    utterance.onend = onEnd;
    utterance.onerror = onError;
    if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });

    fallbackTimer = setTimeout(() => {
      if (settled) return;
      // The synth never fired onend — likely the iOS Safari bug. Cancel the
      // utterance to free the queue and resolve so playback can continue.
      settled = true;
      cleanup();
      synth.cancel();
      resolve();
    }, fallbackMs);

    synth.speak(utterance);
  });
}

/**
 * Force-cancel any in-flight or queued utterances. Safe to call when no
 * speech is in progress (no-op).
 */
export function cancelSpeech(): void {
  if (!isWebSpeechAvailable()) return;
  globalThis.speechSynthesis.cancel();
}

/**
 * Test seam — clears the cached voice list. Tests that swap the
 * speechSynthesis mock between cases call this to force `loadVoices` to
 * re-read voices from the new mock.
 */
export function _resetVoiceCache(): void {
  cachedVoices = null;
}
