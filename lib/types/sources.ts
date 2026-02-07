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
