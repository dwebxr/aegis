/**
 * In-memory mock of the Web Speech API for engine tests.
 *
 * Implements just enough of `SpeechSynthesis` and `SpeechSynthesisUtterance`
 * to drive the AudioBriefingPlayer engine: utterances are queued, fired
 * onstart immediately, and complete via a controllable timer so tests can
 * fast-forward through playback deterministically.
 */

interface MockUtteranceHandlers {
  onstart: ((e: object) => void) | null;
  onend: ((e: object) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onboundary: ((e: object) => void) | null;
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: unknown;
}

class MockUtterance implements MockUtteranceHandlers {
  text: string;
  lang = "en-US";
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onstart: ((e: object) => void) | null = null;
  onend: ((e: object) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onboundary: ((e: object) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

interface MockVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

class MockSpeechSynthesis {
  private queue: MockUtterance[] = [];
  private active: MockUtterance | null = null;
  private listeners: Map<string, Set<() => void>> = new Map();

  voices: MockVoice[] = [
    { voiceURI: "voice-en", name: "English (US)", lang: "en-US", localService: true, default: true },
    { voiceURI: "voice-ja", name: "Japanese", lang: "ja-JP", localService: true, default: false },
  ];

  /** When set, every utterance fires onerror with this code instead of completing. */
  errorMode: string | null = null;

  /**
   * When true, `speak()` fires `onstart` but holds the utterance until
   * `_completeActive()` is called. Lets tests inspect mid-session state
   * (pause/next/prev/setRate) without races.
   */
  deferMode = false;

  /** When true, cancel() fires onend instead of onerror (Safari iOS behaviour). */
  safariCancelMode = false;

  getVoices(): MockVoice[] {
    return this.voices;
  }

  speak(utterance: MockUtterance): void {
    this.queue.push(utterance);
    if (!this.active) this.flush();
  }

  cancel(): void {
    const interrupted = this.active;
    this.active = null;
    this.queue = [];
    if (interrupted) {
      if (this.safariCancelMode) {
        // Safari iOS fires onend instead of onerror on cancel().
        interrupted.onend?.({});
      } else {
        interrupted.onerror?.({ error: "interrupted" });
      }
    }
  }

  pause(): void { /* not used by the engine */ }
  resume(): void { /* not used by the engine */ }

  addEventListener(type: string, handler: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: () => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  /** Test helpers (not part of the real API). */
  _flushAll(): void {
    while (this.queue.length > 0 || this.active) {
      if (this.active && this.deferMode) {
        // In defer mode, _flushAll only flushes utterances that started.
        // Caller drives completion via _completeActive().
        return;
      }
      this.flush();
    }
  }

  /** Completes the currently-held utterance in defer mode. */
  _completeActive(): void {
    const u = this.active;
    if (!u) return;
    this.active = null;
    u.onend?.({});
    this.flush();
  }

  /** Inspect the currently-held utterance text in defer mode. */
  _activeText(): string | null {
    return this.active?.text ?? null;
  }

  _fireVoicesChanged(): void {
    const handlers = this.listeners.get("voiceschanged");
    if (!handlers) return;
    for (const h of handlers) h();
  }

  private flush(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = next;
    next.onstart?.({});
    if (this.errorMode) {
      const code = this.errorMode;
      this.active = null;
      next.onerror?.({ error: code });
      this.flush();
      return;
    }
    if (this.deferMode) {
      // Hold the utterance — the test must call _completeActive() to advance.
      return;
    }
    // Synchronously complete so engine.runSession proceeds without timers.
    this.active = null;
    next.onend?.({});
    this.flush();
  }
}

export interface InstalledMock {
  synth: MockSpeechSynthesis;
  uninstall: () => void;
}

export function installSpeechSynthesisMock(): InstalledMock {
  const synth = new MockSpeechSynthesis();
  const g = globalThis as unknown as {
    speechSynthesis?: MockSpeechSynthesis;
    SpeechSynthesisUtterance?: typeof MockUtterance;
  };
  const prevSynth = g.speechSynthesis;
  const prevUtterance = g.SpeechSynthesisUtterance;
  g.speechSynthesis = synth;
  g.SpeechSynthesisUtterance = MockUtterance;
  return {
    synth,
    uninstall() {
      g.speechSynthesis = prevSynth;
      g.SpeechSynthesisUtterance = prevUtterance;
    },
  };
}
