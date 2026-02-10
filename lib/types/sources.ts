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
