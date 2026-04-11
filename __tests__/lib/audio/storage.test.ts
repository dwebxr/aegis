/**
 * @jest-environment jsdom
 */
import { getAudioPrefs, updateAudioPrefs } from "@/lib/audio/storage";
import { DEFAULT_AUDIO_PREFS } from "@/lib/audio/types";

const KEY = "aegis-audio-prefs";

describe("audio storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getAudioPrefs", () => {
    it("returns defaults when storage is empty", () => {
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("returns a fresh copy of defaults (not the same reference)", () => {
      const a = getAudioPrefs();
      const b = getAudioPrefs();
      expect(a).not.toBe(b);
      expect(a).not.toBe(DEFAULT_AUDIO_PREFS);
    });

    it("returns defaults when stored value is invalid JSON", () => {
      localStorage.setItem(KEY, "{not json");
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("returns defaults when stored value is null/undefined-like", () => {
      localStorage.setItem(KEY, "null");
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("returns defaults when enabled is not a boolean", () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, enabled: "yes" }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("returns defaults when rate is not a finite number", () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, rate: "fast" }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, rate: NaN }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, rate: Infinity }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("returns defaults when rate is out of [0.5, 2.0] range", () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, rate: 0.49 }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, rate: 2.01 }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("accepts boundary rate values", () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, rate: 0.5 }));
      expect(getAudioPrefs().rate).toBe(0.5);
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, rate: 2.0 }));
      expect(getAudioPrefs().rate).toBe(2.0);
    });

    it("returns defaults when voiceURI is non-string non-undefined", () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, voiceURI: 42 }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("accepts a valid voiceURI string", () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, voiceURI: "voice-en" }));
      expect(getAudioPrefs().voiceURI).toBe("voice-en");
    });

    it("returns defaults when preferTranslated is not a boolean", () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, preferTranslated: 1 }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("returns defaults when includeSerendipity is not a boolean", () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_AUDIO_PREFS, includeSerendipity: null }));
      expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    });

    it("returns valid stored prefs unchanged", () => {
      const prefs = {
        enabled: false,
        rate: 1.25,
        voiceURI: "voice-ja",
        preferTranslated: false,
        includeSerendipity: false,
      };
      localStorage.setItem(KEY, JSON.stringify(prefs));
      expect(getAudioPrefs()).toEqual(prefs);
    });

    it("returns defaults when localStorage is undefined", () => {
      const ls = globalThis.localStorage;
      Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
      try {
        expect(getAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
      } finally {
        Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
      }
    });
  });

  describe("updateAudioPrefs", () => {
    it("merges patch into stored prefs", () => {
      const result = updateAudioPrefs({ rate: 1.5 });
      expect(result.rate).toBe(1.5);
      expect(result.enabled).toBe(DEFAULT_AUDIO_PREFS.enabled);
      const stored = JSON.parse(localStorage.getItem(KEY)!);
      expect(stored.rate).toBe(1.5);
    });

    it("multiple updates accumulate", () => {
      updateAudioPrefs({ rate: 1.5 });
      updateAudioPrefs({ preferTranslated: false });
      const result = updateAudioPrefs({ enabled: false });
      expect(result.rate).toBe(1.5);
      expect(result.preferTranslated).toBe(false);
      expect(result.enabled).toBe(false);
    });

    it("empty patch returns current state", () => {
      const before = getAudioPrefs();
      const after = updateAudioPrefs({});
      expect(after).toEqual(before);
    });

    it("does not throw when localStorage is undefined", () => {
      const ls = globalThis.localStorage;
      Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
      try {
        expect(() => updateAudioPrefs({ rate: 1.2 })).not.toThrow();
        const result = updateAudioPrefs({ rate: 1.2 });
        expect(result.rate).toBe(1.2);
      } finally {
        Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
      }
    });

    it("can clear voiceURI by passing undefined", () => {
      updateAudioPrefs({ voiceURI: "voice-en" });
      expect(getAudioPrefs().voiceURI).toBe("voice-en");
      updateAudioPrefs({ voiceURI: undefined });
      expect(getAudioPrefs().voiceURI).toBeUndefined();
    });
  });
});
