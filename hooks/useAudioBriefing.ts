"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getPlayerStatus,
  onPlayerStatusChange,
  startBriefingPlayback,
  pausePlayback,
  resumePlayback,
  nextTrack,
  prevTrack,
  stopPlayback,
  setPlaybackRate,
} from "@/lib/audio/engine";
import { isWebSpeechAvailable } from "@/lib/audio/webspeech";
import { getAudioPrefs, updateAudioPrefs } from "@/lib/audio/storage";
import type { AudioPrefs, PlayerStatusSnapshot, TrackSource } from "@/lib/audio/types";

export interface UseAudioBriefingResult {
  status: PlayerStatusSnapshot;
  prefs: AudioPrefs;
  /** True when the underlying Web Speech API is usable in this environment. */
  available: boolean;
  start: (sources: ReadonlyArray<TrackSource>) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
  setPrefs: (patch: Partial<AudioPrefs>) => void;
}

/**
 * React binding for the audio briefing engine.
 *
 * Subscribes to the engine's status emitter and re-renders the consumer
 * whenever the player state changes. The engine itself lives outside React
 * (singleton in `lib/audio/engine.ts`) so playback survives unmounts of the
 * BriefingTab — the hook is just a view into that state.
 *
 * The hook also reads / writes the persisted AudioPrefs (rate, voice,
 * preferTranslated, etc.) so settings UIs can use the same hook without
 * needing to import storage helpers directly.
 */
export function useAudioBriefing(): UseAudioBriefingResult {
  const [status, setStatus] = useState<PlayerStatusSnapshot>(() => getPlayerStatus());
  const [prefs, setLocalPrefs] = useState<AudioPrefs>(() => getAudioPrefs());
  const [available, setAvailable] = useState<boolean>(false);

  useEffect(() => {
    setAvailable(isWebSpeechAvailable());
    const unsubscribe = onPlayerStatusChange(setStatus);
    return unsubscribe;
  }, []);

  const start = useCallback((sources: ReadonlyArray<TrackSource>) => {
    void startBriefingPlayback(sources, prefs);
  }, [prefs]);

  const setRate = useCallback((rate: number) => {
    const next = updateAudioPrefs({ rate });
    setLocalPrefs(next);
    setPlaybackRate(rate);
  }, []);

  const setPrefs = useCallback((patch: Partial<AudioPrefs>) => {
    const next = updateAudioPrefs(patch);
    setLocalPrefs(next);
    if (patch.rate !== undefined) setPlaybackRate(patch.rate);
  }, []);

  return {
    status,
    prefs,
    available,
    start,
    pause: pausePlayback,
    resume: resumePlayback,
    next: nextTrack,
    prev: prevTrack,
    stop: stopPlayback,
    setRate,
    setPrefs,
  };
}
