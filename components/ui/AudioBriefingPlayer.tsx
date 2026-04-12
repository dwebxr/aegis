"use client";
import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  PlayIcon,
  PauseIcon,
  SkipPrevIcon,
  SkipNextIcon,
  XCloseIcon,
} from "@/components/icons";
import type { UseAudioBriefingResult } from "@/hooks/useAudioBriefing";
import { loadVoices } from "@/lib/audio/webspeech";

const RATE_OPTIONS: ReadonlyArray<number> = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

interface AudioBriefingPlayerProps {
  audio: UseAudioBriefingResult;
  mobile?: boolean;
}

/**
 * Floating bottom player surfaced while a briefing is being read aloud.
 * Pure view layer — all state lives in the audio engine singleton via
 * `useAudioBriefing`. Renders nothing when the engine is idle.
 */
export const AudioBriefingPlayer: React.FC<AudioBriefingPlayerProps> = ({ audio, mobile }) => {
  const { status, prefs, pause, resume, next, prev, stop, setRate } = audio;
  const [voiceLabel, setVoiceLabel] = useState<string>("");

  useEffect(() => {
    if (!prefs.voiceURI) {
      setVoiceLabel("");
      return;
    }
    let cancelled = false;
    void loadVoices().then((voices) => {
      if (cancelled) return;
      const found = voices.find(v => v.voiceURI === prefs.voiceURI);
      setVoiceLabel(found ? `${found.name} (${found.lang})` : "");
    });
    return () => {
      cancelled = true;
    };
  }, [prefs.voiceURI]);

  if (status.status === "idle") return null;

  const isLoading = status.status === "loading";
  const isError = status.status === "error";
  const isPaused = status.status === "paused";
  const trackTitle = status.currentTrack?.title ?? (isLoading ? "Preparing…" : "");
  const trackAuthor = status.currentTrack?.author ?? "";
  const positionLabel = status.trackCount > 0 && status.trackIndex >= 0
    ? `${status.trackIndex + 1} / ${status.trackCount}`
    : "";

  const onPlayPauseClick = () => {
    if (isPaused) resume();
    else if (status.status === "playing") pause();
  };

  const playPauseLabel = isPaused ? "Resume audio briefing" : "Pause audio briefing";
  const PlayPauseGlyph = isPaused ? PlayIcon : PauseIcon;

  return (
    <div
      role="region"
      aria-label="Audio briefing player"
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-40 bg-card border border-border shadow-lg rounded-lg",
        "backdrop-blur-md",
        mobile
          ? "bottom-[calc(var(--mobile-nav-h)+0.75rem)] w-[calc(100vw-1.5rem)] max-w-md px-3 py-3"
          : "bottom-6 w-[640px] max-w-[calc(100vw-3rem)] px-5 py-3",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn(
              "inline-block size-[7px] rounded-full shrink-0",
              isError ? "bg-red-400" : isPaused ? "bg-amber-400" : "bg-emerald-400",
              !isPaused && !isError && !isLoading && "animate-pulse",
            )} />
            <span className="text-caption text-muted-foreground font-mono shrink-0">
              {isError ? "Error" : isLoading ? "Loading…" : positionLabel}
            </span>
            {voiceLabel && !mobile && (
              <span className="text-caption text-disabled font-mono truncate">
                · {voiceLabel}
              </span>
            )}
          </div>
          <div className={cn("text-body-sm font-semibold text-foreground truncate", mobile && "text-[13px]")}>
            {isError ? (status.error ?? "Audio playback failed") : trackTitle}
          </div>
          {trackAuthor && !isError && (
            <div className="text-caption text-muted-foreground truncate">{trackAuthor}</div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={prev}
            disabled={isLoading || isError || status.trackIndex <= 0}
            aria-label="Previous article"
            className={cn(
              "p-2 rounded-md text-muted-foreground bg-transparent border-none cursor-pointer transition-colors",
              "hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed",
            )}
          >
            <SkipPrevIcon s={mobile ? 18 : 20} />
          </button>

          <button
            type="button"
            onClick={onPlayPauseClick}
            disabled={isLoading || isError}
            aria-label={playPauseLabel}
            className={cn(
              "p-2 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 cursor-pointer transition-colors",
              "hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed",
            )}
          >
            <PlayPauseGlyph s={mobile ? 18 : 20} />
          </button>

          <button
            type="button"
            onClick={next}
            disabled={isLoading || isError || status.trackIndex >= status.trackCount - 1}
            aria-label="Next article"
            className={cn(
              "p-2 rounded-md text-muted-foreground bg-transparent border-none cursor-pointer transition-colors",
              "hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed",
            )}
          >
            <SkipNextIcon s={mobile ? 18 : 20} />
          </button>

          {!mobile && (
            <select
              value={status.rate}
              onChange={e => setRate(parseFloat(e.target.value))}
              aria-label="Playback speed"
              className="ml-2 px-2 py-1 bg-overlay border border-subtle rounded-sm text-foreground text-caption font-mono outline-none cursor-pointer"
            >
              {RATE_OPTIONS.map(r => (
                <option key={r} value={r}>{r.toFixed(2)}×</option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={stop}
            aria-label="Close audio player"
            className={cn(
              "p-2 rounded-md text-muted-foreground bg-transparent border-none cursor-pointer transition-colors ml-1",
              "hover:text-foreground",
            )}
          >
            <XCloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
};
