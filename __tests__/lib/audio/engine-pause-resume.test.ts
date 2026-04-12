/**
 * @jest-environment jsdom
 *
 * Pause/resume/skip flow tests. Uses deferMode so each utterance is held
 * until explicitly completed via _completeActive().
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
    avatar: "",
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

// Text that produces 2 chunks when combined as title + body by buildTracks.
// buildTitle takes line 1 (≤80 chars), buildBody takes line 2+.
// spoken = title + " — " + body, then chunkText splits at 150 chars.
const MULTI_CHUNK_TEXT = [
  "Article Title Here",
  "First sentence of the body text. Second sentence with more details about the topic. Third sentence with additional context. Fourth sentence concluding the argument.",
].join("\n");

describe("engine — pause/resume continuation", () => {
  let mock: ReturnType<typeof installSpeechSynthesisMock>;

  beforeEach(() => {
    mock = installSpeechSynthesisMock();
    _resetVoiceCache();
    _resetEngine();
    mock.synth.deferMode = true;
  });

  afterEach(() => {
    mock.synth.deferMode = false;
    _resetEngine();
    mock.uninstall();
  });

  it("pause then resume continues playback to completion (single track)", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Hello world."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();
    expect(getPlayerStatus().status).toBe("playing");

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");

    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("pause then resume continues through multi-track queue", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "First."), isSerendipity: false },
      { item: makeItem("b", "Second."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(0);

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");
    expect(getPlayerStatus().trackIndex).toBe(0);

    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);
    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("multiple pause/resume cycles all complete successfully", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Content."), isSerendipity: false },
      { item: makeItem("b", "More."), isSerendipity: false },
      { item: makeItem("c", "Final."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    // Cycle through all 3 tracks with pause/resume on each
    for (const expectedNext of [1, 2]) {
      pausePlayback();
      await flush();
      expect(getPlayerStatus().status).toBe("paused");
      resumePlayback();
      await flush();
      mock.synth._completeActive();
      await flush();
      await flush();
      expect(getPlayerStatus().trackIndex).toBe(expectedNext);
    }

    pausePlayback();
    await flush();
    resumePlayback();
    await flush();
    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("next during active playback skips to next track and continues", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "First track."), isSerendipity: false },
      { item: makeItem("b", "Second track."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(0);

    nextTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);
    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("prev during active playback restarts current track and continues", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "First track."), isSerendipity: false },
      { item: makeItem("b", "Second track."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    nextTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);

    prevTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(0);
    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);

    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("prev at track 0 restarts chunk 0 and continues to completion", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Only track."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(0);

    prevTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(0);
    expect(getPlayerStatus().chunkIndex).toBe(0);
    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("pause → next → resume plays the new track", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "First."), isSerendipity: false },
      { item: makeItem("b", "Second."), isSerendipity: false },
      { item: makeItem("c", "Third."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");
    expect(getPlayerStatus().trackIndex).toBe(0);

    nextTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);
    expect(getPlayerStatus().status).toBe("paused");

    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");
    expect(getPlayerStatus().trackIndex).toBe(1);

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(2);

    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("pause → prev → resume plays the previous track", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "First."), isSerendipity: false },
      { item: makeItem("b", "Second."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    nextTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);

    pausePlayback();
    await flush();

    prevTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(0);
    expect(getPlayerStatus().status).toBe("paused");

    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();
    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("stop while paused returns to idle", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Content."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");

    stopPlayback();
    const final = getPlayerStatus();
    expect(final.status).toBe("idle");
    expect(final.trackIndex).toBe(-1);
    expect(final.currentTrack).toBeNull();
  });

  it("starting a new session while paused aborts the old one", async () => {
    const first: TrackSource[] = [
      { item: makeItem("a", "Old session."), isSerendipity: false },
    ];
    await startBriefingPlayback(first, DEFAULT_AUDIO_PREFS);
    await flush();

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");

    // Start a completely new session
    const second: TrackSource[] = [
      { item: makeItem("b", "New session."), isSerendipity: false },
    ];
    await startBriefingPlayback(second, DEFAULT_AUDIO_PREFS);
    await flush();

    expect(getPlayerStatus().status).toBe("playing");
    expect(getPlayerStatus().trackIndex).toBe(0);
    expect(getPlayerStatus().trackCount).toBe(1);

    // Complete the new session
    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("setPlaybackRate while paused preserves paused status", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Content."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");

    setPlaybackRate(1.75);
    expect(getPlayerStatus().status).toBe("paused");
    expect(getPlayerStatus().rate).toBe(1.75);

    // Resume at new rate and complete
    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");
    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("rapid pause/resume does not corrupt engine state", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Content."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    pausePlayback();
    resumePlayback();
    pausePlayback();
    resumePlayback();
    await flush();

    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("next → next rapidly skips two tracks and continues", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "First."), isSerendipity: false },
      { item: makeItem("b", "Second."), isSerendipity: false },
      { item: makeItem("c", "Third."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    nextTrack();
    nextTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(2);
    expect(getPlayerStatus().status).toBe("playing");

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("status snapshots through pause/resume show correct sequence", async () => {
    const snapshots: PlayerStatusSnapshot[] = [];
    const unsub = onPlayerStatusChange(s => snapshots.push({ ...s }));

    const sources: TrackSource[] = [
      { item: makeItem("a", "Track one."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    pausePlayback();
    await flush();
    resumePlayback();
    await flush();

    mock.synth._completeActive();
    await flush();
    await flush();

    unsub();

    const statuses = snapshots.map(s => s.status);
    expect(statuses).toContain("loading");
    expect(statuses).toContain("playing");
    expect(statuses).toContain("paused");
    expect(statuses[statuses.length - 1]).toBe("idle");

    const firstPlaying = statuses.indexOf("playing");
    const paused = statuses.indexOf("paused");
    const resumedPlaying = statuses.indexOf("playing", paused);
    expect(firstPlaying).toBeLessThan(paused);
    expect(paused).toBeLessThan(resumedPlaying);
  });

  it("next while paused on last track is a no-op — stays paused on last track", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "First."), isSerendipity: false },
      { item: makeItem("b", "Last."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    nextTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);

    pausePlayback();
    await flush();

    nextTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);
    expect(getPlayerStatus().status).toBe("paused");

    resumePlayback();
    await flush();
    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("prev while paused at track 0 resets chunk and stays paused", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Content."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    pausePlayback();
    await flush();

    prevTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(0);
    expect(getPlayerStatus().chunkIndex).toBe(0);
    expect(getPlayerStatus().status).toBe("paused");

    resumePlayback();
    await flush();
    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });
});

describe("engine — multi-chunk pause/resume with content verification", () => {
  let mock: ReturnType<typeof installSpeechSynthesisMock>;

  beforeEach(() => {
    mock = installSpeechSynthesisMock();
    _resetVoiceCache();
    _resetEngine();
    mock.synth.deferMode = true;
  });

  afterEach(() => {
    mock.synth.deferMode = false;
    _resetEngine();
    mock.uninstall();
  });

  it("pause at chunk 0, resume replays chunk 0 with same text", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", MULTI_CHUNK_TEXT), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    expect(getPlayerStatus().status).toBe("playing");
    expect(getPlayerStatus().chunkIndex).toBe(0);

    const chunk0Text = mock.synth._activeText();
    expect(chunk0Text).toBeTruthy();

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");
    expect(getPlayerStatus().chunkIndex).toBe(0);

    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");
    expect(mock.synth._activeText()).toBe(chunk0Text);

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().chunkIndex).toBe(1);

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("pause at chunk 1, resume replays chunk 1 (not chunk 0)", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", MULTI_CHUNK_TEXT), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    const chunk0Text = mock.synth._activeText();

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().chunkIndex).toBe(1);

    const chunk1Text = mock.synth._activeText();
    expect(chunk1Text).toBeTruthy();
    expect(chunk1Text).not.toBe(chunk0Text);

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");
    expect(getPlayerStatus().chunkIndex).toBe(1);

    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");
    expect(mock.synth._activeText()).toBe(chunk1Text);

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("next mid-chunk resets to chunk 0 of the new track", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", MULTI_CHUNK_TEXT), isSerendipity: false },
      { item: makeItem("b", "Short second track."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().chunkIndex).toBe(1);

    nextTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);
    expect(getPlayerStatus().chunkIndex).toBe(0);

    const activeText = mock.synth._activeText();
    expect(activeText).toBeTruthy();
    expect(activeText!.toLowerCase()).toContain("short second track");

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("prev mid-chunk resets to chunk 0 of previous track", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Short first track."), isSerendipity: false },
      { item: makeItem("b", MULTI_CHUNK_TEXT), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(1);
    expect(getPlayerStatus().chunkIndex).toBe(1);

    prevTrack();
    await flush();
    expect(getPlayerStatus().trackIndex).toBe(0);
    expect(getPlayerStatus().chunkIndex).toBe(0);

    const activeText = mock.synth._activeText();
    expect(activeText).toBeTruthy();
    expect(activeText!.toLowerCase()).toContain("short first track");

    mock.synth._completeActive();
    await flush();
    await flush();
    mock.synth._completeActive();
    await flush();
    await flush();
    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });

  it("no redundant status emissions on pause/resume cycle", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", MULTI_CHUNK_TEXT), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    const emissions: string[] = [];
    const unsub = onPlayerStatusChange(s => emissions.push(s.status));
    emissions.length = 0; // discard initial fire

    pausePlayback();
    await flush();
    resumePlayback();
    await flush();

    expect(emissions.filter(s => s === "paused")).toHaveLength(1);
    expect(emissions.filter(s => s === "playing")).toHaveLength(1);

    unsub();
    mock.synth._completeActive();
    await flush();
    await flush();
    mock.synth._completeActive();
    await flush();
    await flush();
  });

  it("setPlaybackRate mid-track updates snapshot and completes normally", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", MULTI_CHUNK_TEXT), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, { ...DEFAULT_AUDIO_PREFS, rate: 1.0 });
    await flush();

    mock.synth._completeActive();
    await flush();
    await flush();

    setPlaybackRate(2.0);
    expect(getPlayerStatus().rate).toBe(2.0);

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });
});

describe("engine — Safari iOS cancel() fires onend (safariCancelMode)", () => {
  let mock: ReturnType<typeof installSpeechSynthesisMock>;

  beforeEach(() => {
    mock = installSpeechSynthesisMock();
    _resetVoiceCache();
    _resetEngine();
    mock.synth.deferMode = true;
    mock.synth.safariCancelMode = true;
  });

  afterEach(() => {
    mock.synth.deferMode = false;
    mock.synth.safariCancelMode = false;
    _resetEngine();
    mock.uninstall();
  });

  it("pause emits 'paused' even when cancel() triggers onend instead of onerror", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "First."), isSerendipity: false },
      { item: makeItem("b", "Second."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();
    expect(getPlayerStatus().status).toBe("playing");

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");
  });

  it("pause then resume replays the interrupted chunk in Safari cancel mode", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", "Content here."), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");

    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");

    // cancelGeneration detects the Safari onend-on-cancel, so the
    // interrupted chunk replays (same as Chrome onerror path).
    mock.synth._completeActive();
    await flush();
    await flush();

    expect(getPlayerStatus().status).toBe("idle");
  });

  it("Safari multi-chunk: pause replays the same chunk (no skip)", async () => {
    const sources: TrackSource[] = [
      { item: makeItem("a", MULTI_CHUNK_TEXT), isSerendipity: false },
    ];
    await startBriefingPlayback(sources, DEFAULT_AUDIO_PREFS);
    await flush();

    const chunk0Text = mock.synth._activeText();
    expect(chunk0Text).toBeTruthy();
    expect(getPlayerStatus().chunkIndex).toBe(0);

    pausePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("paused");
    expect(getPlayerStatus().chunkIndex).toBe(0);

    resumePlayback();
    await flush();
    expect(getPlayerStatus().status).toBe("playing");
    // Same chunk replays — cancelGeneration prevents skip
    expect(mock.synth._activeText()).toBe(chunk0Text);
    expect(getPlayerStatus().chunkIndex).toBe(0);

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().chunkIndex).toBe(1);

    mock.synth._completeActive();
    await flush();
    await flush();
    expect(getPlayerStatus().status).toBe("idle");
  });
});
