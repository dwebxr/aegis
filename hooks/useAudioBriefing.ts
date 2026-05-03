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

// View into the singleton engine in lib/audio/engine.ts; playback survives BriefingTab unmounts.
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
