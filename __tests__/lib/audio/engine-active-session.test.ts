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

// MediaSession mock — captures action handlers so we can drive them from tests.
class MockMediaMetadata {
  title: string;
  constructor(init: { title: string }) { this.title = init.title; }
}
interface MockMS {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  actions: Record<string, (() => void) | null>;
  setActionHandler: (type: string, h: (() => void) | null) => void;
}
function installMediaSession(): MockMS {
  const actions: Record<string, (() => void) | null> = {};
  const ms: MockMS = {
    metadata: null,
    playbackState: "none",
    actions,
    setActionHandler(type, h) { actions[type] = h; },
  };
  Object.defineProperty(navigator, "mediaSession", { value: ms, configurable: true });
  (globalThis as unknown as { MediaMetadata: typeof MockMediaMetadata }).MediaMetadata = MockMediaMetadata;
  return ms;
}
function uninstallMediaSession() {
  delete (navigator as Navigator & { mediaSession?: unknown }).mediaSession;
  delete (globalThis as unknown as { MediaMetadata?: unknown }).MediaMetadata;
}

describe("AudioBriefingPlayer engine — active session controls", () => {
  let mock: ReturnType<typeof installSpeechSynthesisMock>;
  let ms: MockMS;

  beforeEach(() => {
    mock = installSpeechSynthesisMock();
    ms = installMediaSession();
    _resetVoiceCache();
    _resetEngine();
    mock.synth.deferMode = true;
  });

  afterEach(() => {
    mock.synth.deferMode = false;
    _resetEngine();
    mock.uninstall();
    uninstallMediaSession();
  });

  describe("nextTrack with multiple tracks in defer mode", () => {
    it("advances trackIndex and resets chunkIndex", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "First article."), isSerendipity: false },
        { item: makeItem("b", "Second article."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      // Engine should be playing track 0
      expect(getPlayerStatus().trackIndex).toBe(0);
      expect(getPlayerStatus().status).toBe("playing");

      nextTrack();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(1);
      expect(getPlayerStatus().chunkIndex).toBe(0);
    });

    it("nextTrack on the last track is a no-op", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "First."), isSerendipity: false },
        { item: makeItem("b", "Second."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      nextTrack();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(1);
      nextTrack();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(1);
    });
  });

  describe("prevTrack", () => {
    it("on track 0 resets chunkIndex without changing trackIndex", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "First."), isSerendipity: false },
        { item: makeItem("b", "Second."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(0);
      prevTrack();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(0);
      expect(getPlayerStatus().chunkIndex).toBe(0);
    });

    it("on track > 0 decrements trackIndex", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "First."), isSerendipity: false },
        { item: makeItem("b", "Second."), isSerendipity: false },
        { item: makeItem("c", "Third."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      nextTrack();
      await flush();
      nextTrack();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(2);

      prevTrack();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(1);

      prevTrack();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(0);
    });
  });

  describe("pause / resume", () => {
    it("pause emits 'paused' status with current track preserved", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Article one."), isSerendipity: false },
        { item: makeItem("b", "Article two."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(getPlayerStatus().status).toBe("playing");

      pausePlayback();
      await flush();
      expect(getPlayerStatus().status).toBe("paused");
      expect(getPlayerStatus().currentTrack).not.toBeNull();
    });

    it("pause then pause again is a no-op (does not double-set the gate)", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Hello."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      pausePlayback();
      pausePlayback();
      expect(getPlayerStatus().status).toBe("paused");
    });

    it("resume from paused emits 'playing'", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Hello world content."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      pausePlayback();
      expect(getPlayerStatus().status).toBe("paused");

      resumePlayback();
      expect(getPlayerStatus().status).toBe("playing");
    });

    it("resume without prior pause is a no-op", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Hello."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(getPlayerStatus().status).toBe("playing");
      resumePlayback();
      expect(getPlayerStatus().status).toBe("playing");
    });
  });

  describe("setPlaybackRate during active session", () => {
    it("updates the snapshot rate in real time", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Lengthy content for rate test."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(getPlayerStatus().rate).toBe(1.0);

      setPlaybackRate(1.5);
      expect(getPlayerStatus().rate).toBe(1.5);

      setPlaybackRate(0.75);
      expect(getPlayerStatus().rate).toBe(0.75);
    });
  });

  describe("status emitter mid-session", () => {
    it("emits multiple snapshots as the engine progresses", async () => {
      const snapshots: PlayerStatusSnapshot[] = [];
      const unsub = onPlayerStatusChange(s => snapshots.push({ ...s }));

      const sources: TrackSource[] = [
        { item: makeItem("a", "First article."), isSerendipity: false },
        { item: makeItem("b", "Second article."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      pausePlayback();
      nextTrack();
      resumePlayback();
      await flush();

      const statuses = snapshots.map(s => s.status);
      expect(statuses).toContain("loading");
      expect(statuses).toContain("playing");
      expect(statuses).toContain("paused");
      unsub();
    });
  });

  describe("stop during active session", () => {
    it("returns to idle and clears track state", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Article one."), isSerendipity: false },
        { item: makeItem("b", "Article two."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(getPlayerStatus().status).toBe("playing");

      stopPlayback();
      const final = getPlayerStatus();
      expect(final.status).toBe("idle");
      expect(final.trackIndex).toBe(-1);
      expect(final.currentTrack).toBeNull();
    });
  });

  describe("restart preserves correct track on second start()", () => {
    it("aborts previous session and re-initializes track index", async () => {
      const first: TrackSource[] = [
        { item: makeItem("a", "First batch."), isSerendipity: false },
        { item: makeItem("b", "First batch 2."), isSerendipity: false },
      ];
      await startBriefingPlayback(first, DEFAULT_AUDIO_PREFS);
      await flush();
      nextTrack();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(1);

      const second: TrackSource[] = [
        { item: makeItem("c", "Second batch."), isSerendipity: false },
      ];
      await startBriefingPlayback(second, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(0);
      expect(getPlayerStatus().trackCount).toBe(1);
    });
  });

  describe("MediaSession action handlers", () => {
    it("registers all five OS-level action handlers when playback starts", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "OS-level test."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(typeof ms.actions["play"]).toBe("function");
      expect(typeof ms.actions["pause"]).toBe("function");
      expect(typeof ms.actions["nexttrack"]).toBe("function");
      expect(typeof ms.actions["previoustrack"]).toBe("function");
      expect(typeof ms.actions["stop"]).toBe("function");
    });

    it("OS pause handler pauses the engine", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Article one."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      ms.actions["pause"]?.();
      await flush();
      expect(getPlayerStatus().status).toBe("paused");
    });

    it("OS play handler resumes the engine when paused", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Article."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      ms.actions["pause"]?.();
      ms.actions["play"]?.();
      expect(getPlayerStatus().status).toBe("playing");
    });

    it("OS nexttrack/previoustrack handlers move between tracks", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "First."), isSerendipity: false },
        { item: makeItem("b", "Second."), isSerendipity: false },
        { item: makeItem("c", "Third."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(0);

      ms.actions["nexttrack"]?.();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(1);

      ms.actions["previoustrack"]?.();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(0);
    });

    it("OS stop handler ends the session", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Article."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      ms.actions["stop"]?.();
      expect(getPlayerStatus().status).toBe("idle");
    });

    it("publishes track metadata to navigator.mediaSession.metadata", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Article one for metadata."), isSerendipity: false },
        { item: makeItem("b", "Article two for metadata."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      expect(ms.metadata).not.toBeNull();
      expect((ms.metadata as { title: string }).title).toMatch(/\(1\/2\)/);
    });

    it("clears OS handlers and metadata on stop", async () => {
      const sources: TrackSource[] = [
        { item: makeItem("a", "Article."), isSerendipity: false },
      ];
      await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
      await flush();
      stopPlayback();
      expect(ms.actions["play"]).toBeNull();
      expect(ms.actions["pause"]).toBeNull();
      expect(ms.metadata).toBeNull();
      expect(ms.playbackState).toBe("none");
    });
  });
});
