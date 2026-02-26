export interface SavedSource {
  id: string;
  type: "rss" | "nostr" | "farcaster";
  label: string;
  enabled: boolean;
  feedUrl?: string;
  relays?: string[];
  pubkeys?: string[];
  fid?: number;
  username?: string;
  createdAt: number;
}
