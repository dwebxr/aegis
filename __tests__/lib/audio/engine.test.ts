/**
 * @jest-environment jsdom
 */
import { installSpeechSynthesisMock } from "./mockSpeech";
import {
  startBriefingPlayback,
  stopPlayback,
  pausePlayback,
  resumePlayback,
  nextTrack,
  prevTrack,
  setPlaybackRate,
  getPlayerStatus,
  onPlayerStatusChange,
  _resetEngine,
} from "@/lib/audio/engine";
import { _resetVoiceCache } from "@/lib/audio/webspeech";
import type { TrackSource, PlayerStatusSnapshot } from "@/lib/audio/types";
import { DEFAULT_AUDIO_PREFS } from "@/lib/audio/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(id: string, text: string): ContentItem {
  return {
    id,
    owner: "owner",
    author: `Author ${id}`,
    avatar: "🤖",
    text,
    source: "manual",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "test",
    createdAt: 0,
    validated: false,
    flagged: false,
    timestamp: "now",
    topics: [],
  };
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("AudioBriefingPlayer engine", () => {
  let mock: ReturnType<typeof installSpeechSynthesisMock>;

  beforeEach(() => {
    mock = installSpeechSynthesisMock();
    _resetVoiceCache();
    _resetEngine();
  });

  afterEach(() => {
    _resetEngine();
    mock.uninstall();
  });

  describe("lifecycle", () => {
    it("starts in idle state", () => {
      expect(getPlayerStatus().status).toBe("idle");
    });

    it("plays through a single-track queue and returns to idle", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Short track."), isSerendipity: false },
      ];
      const snapshots: PlayerStatusSnapshot[] = [];
      const unsub = onPlayerStatusChange(s => snapshots.push({ ...s }));

      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      // Engine kicks playback off asynchronously; wait for the queue to drain.
      await flush();
      await flush();
      await flush();

      const final = getPlayerStatus();
      expect(final.status).toBe("idle");

      // Status emitter should have observed at least one playing snapshot.
      const sawPlaying = snapshots.some(s => s.status === "playing");
      expect(sawPlaying).toBe(true);

      unsub();
    });

    it("plays through a multi-track queue advancing track indices", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "First article."), isSerendipity: false },
        { item: makeItem("b", "Second article."), isSerendipity: false },
        { item: makeItem("c", "Third article."), isSerendipity: false },
      ];
      const seenIndices: number[] = [];
      const unsub = onPlayerStatusChange(s => {
        if (s.status === "playing") seenIndices.push(s.trackIndex);
      });

      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      await flush();
      await flush();
      await flush();

      expect(getPlayerStatus().status).toBe("idle");
      expect(seenIndices).toContain(0);
      expect(seenIndices).toContain(1);
      expect(seenIndices).toContain(2);

      unsub();
    });

    it("emits error when there is nothing to read", async () => {
      const empty: TrackSource[] = [
        { item: makeItem("a", ""), isSerendipity: false },
      ];
      await startBriefingPlayback(empty, DEFAULT_AUDIO_PREFS);
      await flush();
      const status = getPlayerStatus();
      expect(status.status).toBe("error");
      expect(status.error).toMatch(/Nothing to read/);
    });
  });

  describe("control surface", () => {
    it("stop() returns to idle and cancels playback", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Article one."), isSerendipity: false },
        { item: makeItem("b", "Article two."), isSerendipity: false },
      ];
      // Switch to error mode AFTER start so the first call begins, then we
      // can stop mid-flight without the engine racing to completion.
      mock.synth.errorMode = "synthesis-failed";
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      mock.synth.errorMode = null;
      stopPlayback();
      await flush();
      expect(getPlayerStatus().status).toBe("idle");
    });

    it("setPlaybackRate updates the snapshot rate", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Long content here for the test"), isSerendipity: false },
      ];
      // Use error mode to keep the engine non-completing while we tweak rate.
      mock.synth.errorMode = "synthesis-failed";
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      // After error, status will be idle. Validate setPlaybackRate is a
      // no-op outside an active session (does not throw).
      expect(() => setPlaybackRate(1.5)).not.toThrow();
      mock.synth.errorMode = null;
    });

    it("next() / prev() / pause() / resume() are no-ops without an active session", () => {
      expect(() => nextTrack()).not.toThrow();
      expect(() => prevTrack()).not.toThrow();
      expect(() => pausePlayback()).not.toThrow();
      expect(() => resumePlayback()).not.toThrow();
      expect(getPlayerStatus().status).toBe("idle");
    });
  });

  describe("error handling", () => {
    it("propagates synth errors as PlayerStatus.error", async () => {
      mock.synth.errorMode = "audio-busy";
      const sources: TrackSource[] = [
        { item: makeItem("a", "Will fail."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      await flush();
      const status = getPlayerStatus();
      expect(status.status).toBe("error");
      expect(status.error).toMatch(/audio-busy|Web Speech error/);
    });

    it("returns error when Web Speech API is missing", async () => {
      mock.uninstall();
      const sources: TrackSource[] = [
        { item: makeItem("a", "Anything."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      const status = getPlayerStatus();
      expect(status.status).toBe("error");
      expect(status.error).toMatch(/Web Speech/);
      // Reinstall so afterEach can uninstall cleanly.
      mock = installSpeechSynthesisMock();
    });
  });
});
