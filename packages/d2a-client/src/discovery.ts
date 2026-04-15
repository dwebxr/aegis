import { finalizeEvent } from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";
import {
  KIND_AGENT_PROFILE,
  TAG_D2A_PROFILE,
  TAG_D2A_INTEREST,
  TAG_D2A_CAPACITY,
  TAG_D2A_PRINCIPAL,
  INTEREST_BROADCAST_THRESHOLD,
  RESONANCE_THRESHOLD,
  PEER_EXPIRY_MS,
} from "./protocol";
import type { AgentProfile, ContentManifest, ResonancePrefs } from "./types";
import { decodeManifest } from "./manifest";

/**
 * Returns the Jaccard similarity in [0, 1] between the caller's high-affinity
 * topics and the peer's advertised interests.
 */
export function calculateResonance(
  myPrefs: ResonancePrefs,
  theirProfile: Pick<AgentProfile, "interests">,
): number {
  const myHighTopics = Object.entries(myPrefs.topicAffinities)
    .filter(([, v]) => v >= INTEREST_BROADCAST_THRESHOLD)
    .map(([k]) => k);

  if (myHighTopics.length === 0 || theirProfile.interests.length === 0) return 0;

  const theirSet = new Set(theirProfile.interests);
  let overlap = 0;
  for (const topic of myHighTopics) {
    if (theirSet.has(topic)) overlap++;
  }

  const union = theirSet.size + myHighTopics.length - overlap;
  return union > 0 ? overlap / union : 0;
}

export interface BroadcastPresenceOptions {
  sk: Uint8Array;
  interests: readonly string[];
  capacity: number;
  relayUrls: string[];
  principalId?: string;
  /** Optional pre-built ContentManifest. Will be JSON-stringified into the event content. */
  manifest?: ContentManifest;
}

export async function broadcastPresence(opts: BroadcastPresenceOptions): Promise<void> {
  const { sk, interests, capacity, relayUrls, principalId, manifest } = opts;
  const tags: string[][] = [
    ["d", TAG_D2A_PROFILE],
    [TAG_D2A_CAPACITY, capacity.toString()],
  ];
  if (principalId) tags.push([TAG_D2A_PRINCIPAL, principalId]);
  for (const interest of interests.slice(0, 20)) {
    tags.push([TAG_D2A_INTEREST, interest]);
  }

  const template: EventTemplate = {
    kind: KIND_AGENT_PROFILE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: manifest ? JSON.stringify(manifest) : "",
  };
  const signed = finalizeEvent(template, sk);

  const pool = new SimplePool();
  try {
    const settled = await Promise.allSettled(pool.publish(relayUrls, signed));
    const succeeded = settled.filter(r => r.status === "fulfilled").length;
    if (succeeded === 0 && relayUrls.length > 0) {
      throw new Error(`Presence broadcast failed on all ${relayUrls.length} relays`);
    }
  } finally {
    pool.destroy();
  }
}

export interface DiscoverPeersOptions {
  myPubkey: string;
  myPrefs: ResonancePrefs;
  relayUrls: string[];
}

export async function discoverPeers(opts: DiscoverPeersOptions): Promise<AgentProfile[]> {
  const { myPubkey, myPrefs, relayUrls } = opts;
  const now = Date.now();
  const filter: Filter = {
    kinds: [KIND_AGENT_PROFILE],
    "#d": [TAG_D2A_PROFILE],
    since: Math.floor((now - PEER_EXPIRY_MS) / 1000),
  };

  const pool = new SimplePool();
  let events;
  try {
    events = await pool.querySync(relayUrls, filter);
  } finally {
    pool.destroy();
  }

  const byPubkey = new Map<string, AgentProfile>();
  for (const ev of events) {
    if (ev.pubkey === myPubkey) continue;
    const existing = byPubkey.get(ev.pubkey);
    if (existing && existing.lastSeen >= ev.created_at * 1000) continue;

    const interests: string[] = [];
    let capacity = 5;
    let principalId: string | undefined;

    for (const tag of ev.tags) {
      if (tag[0] === TAG_D2A_INTEREST && tag[1]) interests.push(tag[1]);
      if (tag[0] === TAG_D2A_CAPACITY && tag[1]) {
        const parsed = parseInt(tag[1], 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) capacity = parsed;
      }
      if (tag[0] === TAG_D2A_PRINCIPAL && tag[1]) principalId = tag[1];
    }

    let manifest: ContentManifest | undefined;
    if (ev.content && ev.content.length > 0) {
      const decoded = decodeManifest(ev.content);
      if (decoded) manifest = decoded;
    }

    const profile: AgentProfile = {
      nostrPubkey: ev.pubkey,
      principalId,
      interests,
      capacity,
      lastSeen: ev.created_at * 1000,
      manifest,
    };
    profile.resonance = calculateResonance(myPrefs, profile);
    byPubkey.set(ev.pubkey, profile);
  }

  const passed = Array.from(byPubkey.values()).filter(
    p => (p.resonance ?? 0) >= RESONANCE_THRESHOLD,
  );
  return passed.sort((a, b) => (b.resonance ?? 0) - (a.resonance ?? 0));
}
