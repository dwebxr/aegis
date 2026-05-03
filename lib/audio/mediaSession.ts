// No-ops when navigator.mediaSession is missing (JSDOM, old browsers, non-secure origins). Never throws.

import type { AudioTrack, PlayerStatus } from "./types";

interface MediaSessionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onStop: () => void;
}

interface MediaSessionLike {
  metadata: MediaMetadata | null;
  playbackState: "none" | "paused" | "playing";
  setActionHandler: (
    type: "play" | "pause" | "previoustrack" | "nexttrack" | "stop",
    handler: (() => void) | null,
  ) => void;
}

function getMediaSession(): MediaSessionLike | null {
  if (typeof navigator === "undefined") return null;
  const ms = (navigator as Navigator & { mediaSession?: MediaSessionLike }).mediaSession;
  if (!ms || typeof globalThis.MediaMetadata !== "function") return null;
  return ms;
}

const ALBUM_LABEL = "Aegis Briefing";
const ARTWORK: MediaImage[] = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
];

export function setMediaSessionMetadata(
  track: AudioTrack | null,
  trackIndex: number,
  trackCount: number,
): void {
  const ms = getMediaSession();
  if (!ms) return;

  if (!track) {
    ms.metadata = null;
    return;
  }

  const positionLabel = trackCount > 1 ? ` (${trackIndex + 1}/${trackCount})` : "";
  ms.metadata = new MediaMetadata({
    title: `${track.title}${positionLabel}`,
    artist: track.author,
    album: ALBUM_LABEL,
    artwork: ARTWORK,
  });
}

export function setMediaSessionPlaybackState(status: PlayerStatus): void {
  const ms = getMediaSession();
  if (!ms) return;
  if (status === "playing") ms.playbackState = "playing";
  else if (status === "paused") ms.playbackState = "paused";
  else ms.playbackState = "none";
}

// Returned cleanup detaches handlers; call on engine teardown to avoid leaking across sessions.
export function attachMediaSessionHandlers(handlers: MediaSessionHandlers): () => void {
  const ms = getMediaSession();
  if (!ms) return () => {};

  ms.setActionHandler("play", handlers.onPlay);
  ms.setActionHandler("pause", handlers.onPause);
  ms.setActionHandler("nexttrack", handlers.onNext);
  ms.setActionHandler("previoustrack", handlers.onPrev);
  ms.setActionHandler("stop", handlers.onStop);

  return () => {
    const current = getMediaSession();
    if (!current) return;
    current.setActionHandler("play", null);
    current.setActionHandler("pause", null);
    current.setActionHandler("nexttrack", null);
    current.setActionHandler("previoustrack", null);
    current.setActionHandler("stop", null);
    current.metadata = null;
    current.playbackState = "none";
  };
}
