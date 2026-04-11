/**
 * AudioBriefingPlayer — singleton playback engine.
 *
 * Owns the global state for the briefing audio player and exposes a
 * status-emitter so React components can subscribe without prop-drilling
 * through the BriefingTab tree. The singleton design is intentional: only
 * one TTS session can play at a time (the Web Speech API is itself a
 * global), and we want playback to survive tab navigation within the SPA.
 *
 * State machine:
 *
 *   ┌──────┐  start()   ┌──────────┐  pause() ┌────────┐
 *   │ idle │ ─────────► │ playing  │ ───────► │ paused │
 *   └──────┘ ◄───────── └─────┬────┘ ◄─────── └────────┘
 *      ▲       end / stop()   │      resume()
 *      │                       │ next() / prev()
 *      │                       ▼
 *      │                  (re-enters playing on a new track)
 *      └──── error ◄──── any speakChunk rejection that is not CancelledError
 *
 * Cancellation discipline:
 *   Each playback session has its own AbortController. `start()` aborts the
 *   previous session before constructing a new one, so any in-flight
 *   `speakChunk` resolves with CancelledError immediately and the old loop
 *   exits without touching the new session's state.
 */

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
  /** Last index for which we pushed metadata to MediaSession; -1 = never. */
  lastMetadataIndex: number;
  /** Resolved when paused; recreated when resume() is called. */
  pauseGate: { promise: Promise<void>; release: () => void } | null;
  /** Cleanup function for MediaSession handlers. */
  detachMediaSession: () => void;
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
  // Only refresh OS-level metadata when the track actually changes; it does
  // not need to fire on every chunk.
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
  while (s.trackIndex < s.tracks.length) {
    const track = s.tracks[s.trackIndex];
    emitFromSession(s, "playing");

    while (s.chunkIndex < track.chunks.length) {
      // Honour pause: block until resume() releases the gate.
      if (s.pauseGate) {
        await s.pauseGate.promise;
        if (s.controller.signal.aborted) return;
      }

      const chunk = track.chunks[s.chunkIndex];
      try {
        await speakChunk({
          text: chunk,
          lang: track.lang,
          rate: s.prefs.rate,
          voice: s.voice,
          signal: s.controller.signal,
        });
      } catch (err) {
        if (err instanceof CancelledError) return;
        failSession(s, errMsg(err));
        return;
      }

      // The session may have advanced (next/prev) while we awaited speakChunk;
      // detect that and skip ahead instead of incrementing past the new index.
      if (s.controller.signal.aborted) return;
      s.chunkIndex += 1;
      emitFromSession(s, "playing");
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
  // stop() (and the test reset that calls it) always returns the emitter to
  // its idle baseline, even if a previous failSession had already cleared
  // the session field — otherwise lingering "error" status would leak
  // across calls.
  if (reason === "stop") {
    emitter.emit({ ...INITIAL_SNAPSHOT });
  }
}

async function ensureVoice(prefs: AudioPrefs, lang: string): Promise<SpeechSynthesisVoice | undefined> {
  const voices = await loadVoices();
  return pickVoice(voices, lang, prefs.voiceURI);
}

/**
 * Start a new audio session from a list of TrackSources. Cancels any
 * existing session first. Resolves immediately after the queue starts
 * playing — playback continues asynchronously in the background until the
 * queue is exhausted, an error occurs, or `stop()` is called.
 */
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

  // Pre-resolve a voice for the first track's language; subsequent tracks
  // will reuse the same voice if their language matches, otherwise the
  // engine queries the voice list again (loadVoices() is cached).
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

  // Run the session in the background. Any rejection lands as an error
  // emission inside `runSession` itself.
  void runSession(s);
}

export function pausePlayback(): void {
  if (!session) return;
  if (session.pauseGate) return;
  session.pauseGate = makePauseGate();
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
  cancelSpeech();
  emitFromSession(session, session.pauseGate ? "paused" : "playing");
}

export function prevTrack(): void {
  if (!session) return;
  if (session.trackIndex <= 0) {
    session.chunkIndex = 0;
    cancelSpeech();
    emitFromSession(session, session.pauseGate ? "paused" : "playing");
    return;
  }
  session.trackIndex -= 1;
  session.chunkIndex = 0;
  cancelSpeech();
  emitFromSession(session, session.pauseGate ? "paused" : "playing");
}

export function stopPlayback(): void {
  teardown("stop");
}

/**
 * Apply a new playback rate to the in-flight session. Takes effect on the
 * next chunk (the current chunk plays through at its existing rate, since
 * Web Speech does not support live rate changes on a queued utterance).
 */
export function setPlaybackRate(rate: number): void {
  if (!session) return;
  session.prefs = { ...session.prefs, rate };
  emitFromSession(session, session.pauseGate ? "paused" : "playing");
}

/** Test seam — fully resets the engine to its initial state. */
export function _resetEngine(): void {
  teardown("stop");
  sessionCounter = 0;
}
