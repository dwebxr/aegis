// Promise-based wrapper around SpeechSynthesisUtterance. Handles three quirks:
//   1. iOS Safari onend never fires for utterances >~150 chars (chunker bounds, this is defence in depth).
//   2. Chrome populates getVoices() async via voiceschanged — loadVoices() awaits the list.
//   3. cancel() rejects pending speakChunk promises with CancelledError so the engine can
//      distinguish user-stop from TTS failure.

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

// Preference: explicit voiceURI > local exact > any exact > local prefix > any prefix > default.
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

// Web Speech API expects "en-US" / "ja-JP", not bare ISO codes.
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

interface SpeakChunkOptions {
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

// Fallback timer (text.length/8 + 2s) unblocks the queue if onend never fires (iOS Safari bug).
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
      // External cancel() arrives here as "interrupted"/"canceled" — engine ignores CancelledError.
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
      // iOS Safari onend bug: cancel the silent utterance to free the queue and continue.
      settled = true;
      cleanup();
      synth.cancel();
      resolve();
    }, fallbackMs);

    synth.speak(utterance);
  });
}

export function cancelSpeech(): void {
  if (!isWebSpeechAvailable()) return;
  globalThis.speechSynthesis.cancel();
}

// iOS Safari blocks async speak() unless the first speak happens synchronously inside a gesture.
// Call this at the top of every click handler that may trigger speakChunk, before any await.
export function unlockSpeech(): void {
  if (!isWebSpeechAvailable()) return;
  const synth = globalThis.speechSynthesis;
  const u = new globalThis.SpeechSynthesisUtterance("");
  u.volume = 0;
  u.lang = "en";
  synth.speak(u);
}

// Test seam: clears voice cache so tests swapping the speechSynthesis mock get fresh reads.
export function _resetVoiceCache(): void {
  cachedVoices = null;
}
