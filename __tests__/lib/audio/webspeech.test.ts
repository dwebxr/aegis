/**
 * @jest-environment jsdom
 */
import { installSpeechSynthesisMock } from "./mockSpeech";
import {
  isWebSpeechAvailable,
  loadVoices,
  pickVoice,
  speakChunk,
  cancelSpeech,
  CancelledError,
  _resetVoiceCache,
} from "@/lib/audio/webspeech";

describe("webspeech wrapper", () => {
  let mock: ReturnType<typeof installSpeechSynthesisMock>;

  beforeEach(() => {
    _resetVoiceCache();
    mock = installSpeechSynthesisMock();
  });

  afterEach(() => {
    mock.uninstall();
    _resetVoiceCache();
  });

  describe("availability", () => {
    it("reports available when both APIs exist", () => {
      expect(isWebSpeechAvailable()).toBe(true);
    });

    it("reports unavailable when uninstalled", () => {
      mock.uninstall();
      expect(isWebSpeechAvailable()).toBe(false);
      mock = installSpeechSynthesisMock();
    });
  });

  describe("loadVoices", () => {
    it("returns the synth voice list", async () => {
      const voices = await loadVoices();
      expect(voices).toHaveLength(2);
      expect(voices.find(v => v.lang === "ja-JP")).toBeDefined();
    });

    it("caches between calls", async () => {
      const v1 = await loadVoices();
      const v2 = await loadVoices();
      expect(v1).toBe(v2);
    });

    it("returns empty array when API is missing", async () => {
      mock.uninstall();
      const voices = await loadVoices();
      expect(voices).toEqual([]);
      mock = installSpeechSynthesisMock();
    });
  });

  describe("pickVoice", () => {
    it("returns explicit voice when voiceURI provided", async () => {
      const voices = await loadVoices();
      const v = pickVoice(voices, "en", "voice-ja");
      expect(v?.voiceURI).toBe("voice-ja");
    });

    it("matches by exact BCP-47 lang", async () => {
      const voices = await loadVoices();
      const v = pickVoice(voices, "ja");
      expect(v?.lang).toBe("ja-JP");
    });

    it("falls back to default when no match", async () => {
      const voices = await loadVoices();
      const v = pickVoice(voices, "xx");
      expect(v?.default).toBe(true);
    });

    it("returns undefined for empty voice list", () => {
      expect(pickVoice([], "en")).toBeUndefined();
    });
  });

  describe("speakChunk", () => {
    it("resolves when the utterance ends", async () => {
      await expect(speakChunk({ text: "hello", lang: "en", rate: 1 })).resolves.toBeUndefined();
    });

    it("rejects with CancelledError on synth interruption", async () => {
      // Override mock so the next utterance never completes; cancel manually.
      mock.synth.errorMode = "interrupted";
      await expect(
        speakChunk({ text: "hello", lang: "en", rate: 1 }),
      ).rejects.toBeInstanceOf(CancelledError);
      mock.synth.errorMode = null;
    });

    it("rejects with regular Error on other synth errors", async () => {
      mock.synth.errorMode = "audio-busy";
      const err = await speakChunk({ text: "hello", lang: "en", rate: 1 }).catch(e => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(CancelledError);
      expect(err.message).toMatch(/audio-busy/);
      mock.synth.errorMode = null;
    });

    it("rejects with CancelledError when AbortSignal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        speakChunk({ text: "hello", lang: "en", rate: 1, signal: controller.signal }),
      ).rejects.toBeInstanceOf(CancelledError);
    });

    it("rejects when API is missing", async () => {
      mock.uninstall();
      await expect(speakChunk({ text: "hello", lang: "en", rate: 1 })).rejects.toThrow(
        /Web Speech API not available/,
      );
      mock = installSpeechSynthesisMock();
    });
  });

  describe("cancelSpeech", () => {
    it("is a no-op when API is missing", () => {
      mock.uninstall();
      expect(() => cancelSpeech()).not.toThrow();
      mock = installSpeechSynthesisMock();
    });
  });
});
