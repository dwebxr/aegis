/**
 * MediaSession integration for the audio briefing player.
 *
 * Hooks into `navigator.mediaSession` so that:
 *   - The OS lock screen / notification shade displays the current track
 *     title, author, and a "Aegis Briefing" album label.
 *   - Hardware media keys (Bluetooth headphones, car stereos, AirPods) can
 *     play / pause / skip without bringing the browser tab to the front.
 *
 * Falls back to no-ops when the API is unavailable (e.g. JSDOM, older
 * browsers, or non-secure origins). Never throws.
 */

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

/**
 * Update the metadata shown on the lock screen / notification shade. The
 * caller passes the current track and the total queue position so that
 * "now playing" includes the index (e.g. "Article 2 of 6").
 */
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

/**
 * Mirror the player status to `mediaSession.playbackState` so the OS UI
 * shows the correct play/pause icon.
 */
export function setMediaSessionPlaybackState(status: PlayerStatus): void {
  const ms = getMediaSession();
  if (!ms) return;
  if (status === "playing") ms.playbackState = "playing";
  else if (status === "paused") ms.playbackState = "paused";
  else ms.playbackState = "none";
}

/**
 * Wire the engine's playback handlers to the OS-level action callbacks.
 * Returns a cleanup function that detaches all handlers — call this when
 * the engine is torn down (or when "Listen" is closed) to avoid leaking
 * handlers across sessions.
 */
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
