export type SourcePlatform = "youtube" | "topic" | "github" | "bluesky" | "reddit" | "mastodon" | "farcaster";

export const SOURCE_PLATFORMS: ReadonlySet<string> = new Set<SourcePlatform>(["youtube", "topic", "github", "bluesky", "reddit", "mastodon", "farcaster"]);

/**
 * Source-sync status surfaced by `SourceContext`. Includes "error" because
 * IC source sync can fail in ways the user must see (auth-loss, canister
 * unreachable). Intentionally distinct from `ContentSyncStatus` in
 * `contexts/content/types.ts`, which uses "offline" instead — content sync
 * has an offline-queue path that source sync does not.
 */
export type SourceSyncStatus = "idle" | "syncing" | "synced" | "error";

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
