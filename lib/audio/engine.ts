// Singleton: Web Speech API is global, only one TTS session can play.
//
// State machine:
//   ┌──────┐  start()   ┌──────────┐  pause() ┌────────┐
//   │ idle │ ─────────► │ playing  │ ───────► │ paused │
//   └──────┘ ◄───────── └─────┬────┘ ◄─────── └────────┘
//      ▲       end / stop()   │      resume()
//      │                       │ next() / prev()
//      └──── error ◄──── speakChunk rejection that is not CancelledError
//
// Each session has its own AbortController; start() aborts the previous so an in-flight
// speakChunk resolves with CancelledError and the old loop exits without touching new state.

import { createStatusEmitter } from "@/lib/utils/statusEmitter";
import { errMsg } from "@/lib/utils/errors";
import type {
  AudioTrack,
  AudioPrefs,
  PlayerStatusSnapshot,
  TrackSource,
} from "./types";
import { DEFAULT_AUDIO_PREFS } from "./types";
import { buildTracks } from "./script";
import {
  CancelledError,
  cancelSpeech,
  isWebSpeechAvailable,
  loadVoices,
  pickVoice,
  speakChunk,
} from "./webspeech";
import {
  attachMediaSessionHandlers,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
} from "./mediaSession";

const INITIAL_SNAPSHOT: PlayerStatusSnapshot = {
  status: "idle",
  trackIndex: -1,
  trackCount: 0,
  chunkIndex: 0,
  currentTrack: null,
  rate: DEFAULT_AUDIO_PREFS.rate,
  error: null,
};

const emitter = createStatusEmitter<PlayerStatusSnapshot>(INITIAL_SNAPSHOT);

export const onPlayerStatusChange = emitter.onStatusChange;
export const getPlayerStatus = emitter.getStatus;

interface Session {
  id: number;
  controller: AbortController;
  tracks: AudioTrack[];
  prefs: AudioPrefs;
  voice: SpeechSynthesisVoice | undefined;
  trackIndex: number;
  chunkIndex: number;
  // -1 = MediaSession metadata never pushed.
  lastMetadataIndex: number;
  // Resolved on pause; recreated on resume.
  pauseGate: { promise: Promise<void>; release: () => void } | null;
  detachMediaSession: () => void;
  // Bumped before each cancelSpeech(); detects cancel when Safari fires onend (not onerror).
  cancelGeneration: number;
}

let session: Session | null = null;
let sessionCounter = 0;

function makePauseGate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function emitFromSession(s: Session, status: PlayerStatusSnapshot["status"], error: string | null = null): void {
  const currentTrack = s.tracks[s.trackIndex] ?? null;
  emitter.emit({
    status,
    trackIndex: s.trackIndex,
    trackCount: s.tracks.length,
    chunkIndex: s.chunkIndex,
    currentTrack,
    rate: s.prefs.rate,
    error,
  });
  setMediaSessionPlaybackState(status);
  // OS metadata only on track change, not per chunk.
  if (s.lastMetadataIndex !== s.trackIndex) {
    s.lastMetadataIndex = s.trackIndex;
    setMediaSessionMetadata(currentTrack, s.trackIndex, s.tracks.length);
  }
}

function failSession(s: Session, message: string): void {
  s.detachMediaSession();
  if (session && session.id === s.id) session = null;
  emitter.emit({ ...INITIAL_SNAPSHOT, status: "error", error: message, rate: s.prefs.rate });
}

async function runSession(s: Session): Promise<void> {
  // `continue outer` lets pause/next/prev re-read `track` after trackIndex
  // changes. `skipEmit` avoids a redundant emission — the caller already
  // emitted the correct status before cancelSpeech caused the re-entry.
  let skipEmit = false;
  outer: while (s.trackIndex < s.tracks.length) {
    const track = s.tracks[s.trackIndex];
    if (!skipEmit) emitFromSession(s, s.pauseGate ? "paused" : "playing");
    skipEmit = false;

    while (s.chunkIndex < track.chunks.length) {
      // Honour pause: block until resume() releases the gate.
      if (s.pauseGate) {
        await s.pauseGate.promise;
        if (s.controller.signal.aborted) return;
      }

      const chunk = track.chunks[s.chunkIndex];
      const genBefore = s.cancelGeneration;
      try {
        await speakChunk({
          text: chunk,
          lang: track.lang,
          rate: s.prefs.rate,
          voice: s.voice,
          signal: s.controller.signal,
        });
      } catch (err) {
        if (err instanceof CancelledError) {
          if (s.controller.signal.aborted) return; // real stop/restart
          skipEmit = true;
          continue outer; // pause or skip — re-read track from updated trackIndex
        }
        failSession(s, errMsg(err));
        return;
      }

      if (s.controller.signal.aborted) return;

      // Safari iOS: cancel() fires onend instead of onerror, making
      // speakChunk resolve normally. Detect via generation counter.
      if (s.cancelGeneration !== genBefore) {
        skipEmit = true;
        continue outer;
      }

      s.chunkIndex += 1;
      emitFromSession(s, s.pauseGate ? "paused" : "playing");
    }

    s.trackIndex += 1;
    s.chunkIndex = 0;
  }

  // Reached the end of the queue cleanly.
  s.detachMediaSession();
  emitter.emit({ ...INITIAL_SNAPSHOT });
  if (session && session.id === s.id) session = null;
}

function teardown(reason: "stop" | "restart"): void {
  if (session) {
    const old = session;
    session = null;
    old.controller.abort();
    old.pauseGate?.release();
    old.detachMediaSession();
    cancelSpeech();
  }
  // Always reset emitter on stop so a stale "error" doesn't leak across calls.
  if (reason === "stop") {
    emitter.emit({ ...INITIAL_SNAPSHOT });
  }
}

async function ensureVoice(prefs: AudioPrefs, lang: string): Promise<SpeechSynthesisVoice | undefined> {
  const voices = await loadVoices();
  return pickVoice(voices, lang, prefs.voiceURI);
}

// Cancels any existing session, then resolves once playback starts; the queue runs in the background.
export async function startBriefingPlayback(
  sources: ReadonlyArray<TrackSource>,
  prefs: AudioPrefs,
): Promise<void> {
  if (!isWebSpeechAvailable()) {
    emitter.emit({
      ...INITIAL_SNAPSHOT,
      status: "error",
      error: "Web Speech API not available in this browser",
    });
    return;
  }

  teardown("restart");

  emitter.emit({ ...INITIAL_SNAPSHOT, status: "loading", rate: prefs.rate });

  const tracks = buildTracks(sources, prefs);
  if (tracks.length === 0) {
    emitter.emit({
      ...INITIAL_SNAPSHOT,
      status: "error",
      error: "Nothing to read in the current briefing",
    });
    return;
  }

  const voice = await ensureVoice(prefs, tracks[0].lang);

  const s: Session = {
    id: ++sessionCounter,
    controller: new AbortController(),
    tracks,
    prefs,
    voice,
    trackIndex: 0,
    chunkIndex: 0,
    lastMetadataIndex: -1,
    pauseGate: null,
    detachMediaSession: () => {},
    cancelGeneration: 0,
  };

  s.detachMediaSession = attachMediaSessionHandlers({
    onPlay: () => resumePlayback(),
    onPause: () => pausePlayback(),
    onNext: () => nextTrack(),
    onPrev: () => prevTrack(),
    onStop: () => stopPlayback(),
  });

  session = s;
  emitFromSession(s, "playing");

  // Background loop. Errors emit inside runSession.
  void runSession(s);
}

export function pausePlayback(): void {
  if (!session) return;
  if (session.pauseGate) return;
  session.pauseGate = makePauseGate();
  session.cancelGeneration += 1;
  cancelSpeech();
  emitFromSession(session, "paused");
}

export function resumePlayback(): void {
  if (!session) return;
  if (!session.pauseGate) return;
  const gate = session.pauseGate;
  session.pauseGate = null;
  gate.release();
  emitFromSession(session, "playing");
}

export function nextTrack(): void {
  if (!session) return;
  if (session.trackIndex >= session.tracks.length - 1) return;
  session.trackIndex += 1;
  session.chunkIndex = 0;
  session.cancelGeneration += 1;
  cancelSpeech();
  emitFromSession(session, session.pauseGate ? "paused" : "playing");
}

export function prevTrack(): void {
  if (!session) return;
  if (session.trackIndex > 0) session.trackIndex -= 1;
  session.chunkIndex = 0;
  session.cancelGeneration += 1;
  cancelSpeech();
  emitFromSession(session, session.pauseGate ? "paused" : "playing");
}

export function stopPlayback(): void {
  teardown("stop");
}

// Takes effect on the next chunk; Web Speech doesn't allow live rate changes mid-utterance.
export function setPlaybackRate(rate: number): void {
  if (!session) return;
  session.prefs = { ...session.prefs, rate };
  emitFromSession(session, session.pauseGate ? "paused" : "playing");
}

// Test seam.
export function _resetEngine(): void {
  teardown("stop");
  sessionCounter = 0;
}
