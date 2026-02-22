/**
 * YouTube video ID extraction for embed rendering.
 */

/**
 * Extract YouTube video ID from common URL patterns.
 *
 * Supported: watch?v=, youtu.be/, /shorts/, /embed/
 * Returns null for non-YouTube URLs, channels, playlists, etc.
 */
export function extractYouTubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");

  // youtu.be/VIDEO_ID
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split(/[/?#]/)[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host !== "youtube.com") return null;

  // /watch?v=VIDEO_ID
  if (parsed.pathname === "/watch") {
    const v = parsed.searchParams.get("v");
    return v && /^[\w-]{11}$/.test(v) ? v : null;
  }

  // /shorts/VIDEO_ID or /embed/VIDEO_ID
  const pathMatch = parsed.pathname.match(/^\/(shorts|embed)\/([\w-]{11})(?:[/?#]|$)/);
  if (pathMatch) return pathMatch[2];

  return null;
}

/** Build a YouTube embed URL from a video ID. No autoplay. */
export function youTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}
