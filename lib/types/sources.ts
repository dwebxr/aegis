export interface RSSSourceConfig {
  id: string;
  feedUrl: string;
  label: string;
  enabled: boolean;
  lastFetchedAt?: number;
}

export interface TwitterSourceConfig {
  id: string;
  searchQuery: string;
  enabled: boolean;
  lastFetchedAt?: number;
  hasToken: boolean;
}

export interface NostrSourceConfig {
  id: string;
  relays: string[];
  pubkeys: string[];
  hashtags: string[];
  enabled: boolean;
  lastFetchedAt?: number;
}

export type SourceConfig =
  | { type: "rss"; config: RSSSourceConfig }
  | { type: "twitter"; config: TwitterSourceConfig }
  | { type: "nostr"; config: NostrSourceConfig };

/** Persisted source configuration (localStorage + IC) */
export interface SavedSource {
  id: string;
  type: "rss" | "nostr";
  label: string;
  enabled: boolean;
  feedUrl?: string;
  relays?: string[];
  pubkeys?: string[];
  createdAt: number;
}
