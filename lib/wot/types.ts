export interface WoTNode {
  pubkey: string;
  follows: string[];
  hopDistance: number;
  mutualFollows: number;
}

export interface WoTScore {
  pubkey: string;
  trustScore: number;
  hopDistance: number;
  mutualFollows: number;
  isInGraph: boolean;
}

export interface WoTGraph {
  userPubkey: string;
  nodes: Map<string, WoTNode>;
  maxHops: number;
  builtAt: number;
}

export interface SerializedWoTGraph {
  userPubkey: string;
  nodes: Array<[string, WoTNode]>;
  maxHops: number;
  builtAt: number;
}

export interface WoTCacheEntry {
  graph: SerializedWoTGraph;
  cachedAt: number;
  ttl: number;
}

export interface WoTConfig {
  maxHops: number;
  maxNodes: number;
  timeoutPerHopMs: number;
  cacheTTLMs: number;
  relays: string[];
}

export const DEFAULT_WOT_CONFIG: WoTConfig = {
  maxHops: 3,
  maxNodes: 10_000,
  timeoutPerHopMs: 10_000,
  cacheTTLMs: 6 * 60 * 60 * 1000,
  relays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
};
