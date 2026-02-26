import type { SavedSource, SourcePlatform } from "@/lib/types/sources";
import { errMsg } from "@/lib/utils/errors";

const KEY_PREFIX = "aegis_sources_";

/** Infer platform from feedUrl/label for sources saved before the platform field existed. */
export function inferPlatform(s: SavedSource): SourcePlatform | undefined {
  if (s.type === "farcaster") return "farcaster";
  if (s.type !== "rss") return undefined;
  const url = s.feedUrl || "";
  const label = s.label;
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("bsky.app")) return "bluesky";
  if (url.includes("reddit.com")) return "reddit";
  if (url.includes("github.com") && url.endsWith(".atom")) return "github";
  if (url.includes("news.google.com") || label.startsWith("Topic:")) return "topic";
  if (url.includes("feeds.fcstr.xyz")) return "farcaster";
  // Mastodon: label pattern @user@instance or URL containing /@user.rss
  if (/^@.+@.+/.test(label) || /\/@[\w]+\.rss$/.test(url)) return "mastodon";
  return undefined;
}

export function loadSources(principalId: string): SavedSource[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + principalId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const sources = parsed.filter(
      (s): s is SavedSource =>
        s &&
        typeof s.id === "string" &&
        (s.type === "rss" || s.type === "nostr" || s.type === "farcaster") &&
        typeof s.enabled === "boolean" &&
        typeof s.label === "string" &&
        typeof s.createdAt === "number",
    );
    // Backfill platform for sources saved before the platform field existed
    let migrated = false;
    for (const s of sources) {
      if (!s.platform) {
        const inferred = inferPlatform(s);
        if (inferred) { s.platform = inferred; migrated = true; }
      }
    }
    if (migrated) saveSources(principalId, sources);
    return sources;
  } catch (err) {
    console.warn("[sources] Failed to load source configs:", errMsg(err));
    return [];
  }
}

export function saveSources(principalId: string, sources: SavedSource[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(KEY_PREFIX + principalId, JSON.stringify(sources));
    return true;
  } catch (err) {
    console.warn("[sources] Failed to save source configs:", errMsg(err));
    return false;
  }
}
