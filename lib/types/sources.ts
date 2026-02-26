export type SourcePlatform = "youtube" | "topic" | "github" | "bluesky" | "reddit" | "mastodon" | "farcaster";

export const SOURCE_PLATFORMS: ReadonlySet<string> = new Set<SourcePlatform>(["youtube", "topic", "github", "bluesky", "reddit", "mastodon", "farcaster"]);

export interface SavedSource {
  id: string;
  type: "rss" | "nostr" | "farcaster";
  platform?: SourcePlatform;
  label: string;
  enabled: boolean;
  feedUrl?: string;
  relays?: string[];
  pubkeys?: string[];
  fid?: number;
  username?: string;
  createdAt: number;
}
