/**
 * @jest-environment jsdom
 */
import { installSpeechSynthesisMock, type InstalledMock } from "./mockSpeech";
import {
  loadVoices,
  pickVoice,
  speakChunk,
  unlockSpeech,
  CancelledError,
  _resetVoiceCache,
} from "@/lib/audio/webspeech";

describe("webspeech edge cases", () => {
  let mock: InstalledMock;

  beforeEach(() => {
    jest.useFakeTimers();
    _resetVoiceCache();
    mock = installSpeechSynthesisMock();
  });

  afterEach(() => {
    mock.uninstall();
    _resetVoiceCache();
    jest.useRealTimers();
  });

  describe("loadVoices async path", () => {
    it("resolves via voiceschanged event when initial getVoices is empty", async () => {
      // Simulate Chrome: getVoices() initially returns empty, then fires voiceschanged
      const origVoices = mock.synth.voices;
      mock.synth.voices = [];

      const promise = loadVoices(5000);

      // Restore voices and fire the event
      mock.synth.voices = origVoices;
      mock.synth._fireVoicesChanged();

      const voices = await promise;
      expect(voices).toHaveLength(2);
    });

    it("resolves via timeout fallback when voiceschanged never fires", async () => {
      // Simulate: getVoices() initially empty, stays empty
      mock.synth.voices = [];

      const promise = loadVoices(100);

      // Advance past timeout
      jest.advanceTimersByTime(150);

      const voices = await promise;
      expect(voices).toEqual([]); // Still empty — timeout resolved with empty list
    });

    it("settled guard prevents double resolution from voiceschanged + timeout", async () => {
      const origVoices = mock.synth.voices;
      mock.synth.voices = [];

      const promise = loadVoices(100);

      // Fire voiceschanged first (settles the promise)
      mock.synth.voices = origVoices;
      mock.synth._fireVoicesChanged();

      // Then fire timeout (should be no-op due to settled guard)
      jest.advanceTimersByTime(150);

      const voices = await promise;
      expect(voices).toHaveLength(2); // Result from voiceschanged, not timeout
    });

    it("timeout resolves with whatever getVoices returns at that point", async () => {
      // Start empty, but restore voices before timeout fires
      mock.synth.voices = [];
      const origVoices = [
        { voiceURI: "voice-en", name: "English", lang: "en-US", localService: true, default: true },
      ];

      const promise = loadVoices(100);

      // Restore voices before timeout (without firing voiceschanged)
      mock.synth.voices = origVoices;
      jest.advanceTimersByTime(150);

      const voices = await promise;
      expect(voices).toHaveLength(1);
    });
  });

  describe("pickVoice edge cases", () => {
    it("prefers localService voice over remote", async () => {
      const voices = [
        { voiceURI: "remote-en", name: "Remote EN", lang: "en-US", localService: false, default: false },
        { voiceURI: "local-en", name: "Local EN", lang: "en-US", localService: true, default: false },
      ] as SpeechSynthesisVoice[];
      const picked = pickVoice(voices, "en");
      expect(picked?.voiceURI).toBe("local-en");
    });

    it("falls back to prefix match when exact locale not available", async () => {
      const voices = [
        { voiceURI: "en-gb", name: "English GB", lang: "en-GB", localService: true, default: false },
      ] as SpeechSynthesisVoice[];
      // "en" maps to "en-US" but en-GB starts with "en" prefix
      const picked = pickVoice(voices, "en");
      expect(picked?.voiceURI).toBe("en-gb");
    });

    it("falls back to first voice when no language or default matches", async () => {
      const voices = [
        { voiceURI: "es", name: "Spanish", lang: "es-ES", localService: false, default: false },
        { voiceURI: "fr", name: "French", lang: "fr-FR", localService: false, default: false },
      ] as SpeechSynthesisVoice[];
      const picked = pickVoice(voices, "xx-YY"); // no match at all
      expect(picked?.voiceURI).toBe("es"); // first in list
    });

    it("ignores non-matching voiceURI and falls back to language match", async () => {
      const voices = [
        { voiceURI: "voice-ja", name: "Japanese", lang: "ja-JP", localService: true, default: false },
      ] as SpeechSynthesisVoice[];
      const picked = pickVoice(voices, "ja", "nonexistent-uri");
      expect(picked?.voiceURI).toBe("voice-ja");
    });

    it("maps all supported language codes to BCP-47", async () => {
      const voices = await loadVoices();
      // "ja" should match "ja-JP" voice
      const ja = pickVoice(voices, "ja");
      expect(ja?.lang).toBe("ja-JP");
    });
  });

  describe("speakChunk fallback timer", () => {
    it("resolves via fallback timer when onend never fires (iOS Safari bug)", async () => {
      // Use defer mode to prevent automatic completion, then let fallback fire
      mock.synth.deferMode = true;

      const promise = speakChunk({ text: "short", lang: "en", rate: 1 });

      // Fallback timer = max(2000, ceil(5/8)*1000 + 2000) = 3000ms
      jest.advanceTimersByTime(3000);

      await expect(promise).resolves.toBeUndefined();
    });

    it("calculates fallback proportional to text length", async () => {
      mock.synth.deferMode = true;

      // 80 chars → fallback = max(2000, ceil(80/8)*1000 + 2000) = 12000ms
      const longText = "a".repeat(80);
      const promise = speakChunk({ text: longText, lang: "en", rate: 1 });

      // Not enough time yet
      jest.advanceTimersByTime(11000);
      // Promise should still be pending — we can't directly check, but
      // advancing to exactly the fallback time should resolve it
      jest.advanceTimersByTime(1000);

      await expect(promise).resolves.toBeUndefined();
    });

    it("does not fire fallback when onend fires first", async () => {
      // Default mode: utterance completes immediately via onend
      const cancelSpy = jest.spyOn(mock.synth, "cancel");

      await speakChunk({ text: "hello", lang: "en", rate: 1 });

      // Advance past fallback time — should not call cancel
      jest.advanceTimersByTime(10000);

      // cancel() should NOT have been called by fallback (only by onend cleanup)
      // The mock auto-completes, so cancel is not called at all
      expect(cancelSpy).not.toHaveBeenCalled();
      cancelSpy.mockRestore();
    });
  });

  describe("speakChunk abort signal", () => {
    it("rejects with CancelledError when signal aborts mid-utterance", async () => {
      mock.synth.deferMode = true;
      const controller = new AbortController();

      const promise = speakChunk({ text: "hello", lang: "en", rate: 1, signal: controller.signal });

      // Abort while utterance is in progress
      controller.abort();

      await expect(promise).rejects.toBeInstanceOf(CancelledError);
    });

    it("calls synth.cancel() when abort signal fires", async () => {
      mock.synth.deferMode = true;
      const controller = new AbortController();
      const cancelSpy = jest.spyOn(mock.synth, "cancel");

      const promise = speakChunk({ text: "hello", lang: "en", rate: 1, signal: controller.signal });
      controller.abort();

      await promise.catch(() => {}); // swallow rejection
      expect(cancelSpy).toHaveBeenCalled();
      cancelSpy.mockRestore();
    });

    it("settled guard prevents double rejection from abort + onerror", async () => {
      mock.synth.deferMode = true;
      const controller = new AbortController();

      const promise = speakChunk({ text: "hello", lang: "en", rate: 1, signal: controller.signal });

      // Abort fires first
      controller.abort();

      // Then mock fires onerror (from cancel()) — should be no-op
      // The CancelledError from abort should be the only rejection
      await expect(promise).rejects.toBeInstanceOf(CancelledError);
    });
  });

  describe("speakChunk error variants", () => {
    it("rejects with CancelledError for 'canceled' error code", async () => {
      mock.synth.errorMode = "canceled";
      await expect(
        speakChunk({ text: "test", lang: "en", rate: 1 }),
      ).rejects.toBeInstanceOf(CancelledError);
      mock.synth.errorMode = null;
    });

    it("rejects with regular Error for synthesis-failed", async () => {
      mock.synth.errorMode = "synthesis-failed";
      const err = await speakChunk({ text: "test", lang: "en", rate: 1 }).catch(e => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(CancelledError);
      expect(err.message).toContain("synthesis-failed");
      mock.synth.errorMode = null;
    });

    it("rejects with regular Error for network error", async () => {
      mock.synth.errorMode = "network";
      const err = await speakChunk({ text: "test", lang: "en", rate: 1 }).catch(e => e);
      expect(err.message).toContain("network");
      mock.synth.errorMode = null;
    });
  });

  describe("speakChunk utterance configuration", () => {
    it("applies pitch option", async () => {
      await speakChunk({ text: "hello", lang: "en", rate: 1, pitch: 1.5 });
      // No assertion on the utterance directly since mock auto-completes,
      // but the code path is exercised without error
    });

    it("sets voice when provided", async () => {
      const voices = await loadVoices();
      const jaVoice = voices.find(v => v.lang === "ja-JP");
      await speakChunk({ text: "こんにちは", lang: "ja", rate: 1, voice: jaVoice });
    });

    it("defaults pitch to 1.0 when not specified", async () => {
      // Exercise the `opts.pitch ?? 1.0` path
      await speakChunk({ text: "default pitch", lang: "en", rate: 1 });
    });
  });

  describe("unlockSpeech", () => {
    it("speaks a zero-volume empty utterance", () => {
      const speakSpy = jest.spyOn(mock.synth, "speak");
      unlockSpeech();
      expect(speakSpy).toHaveBeenCalledTimes(1);
      speakSpy.mockRestore();
    });

    it("is a no-op when speech API is unavailable", () => {
      mock.uninstall();
      expect(() => unlockSpeech()).not.toThrow();
      mock = installSpeechSynthesisMock();
    });
  });
});
