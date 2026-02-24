import { finalizeEvent } from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";
import type { AgentProfile } from "./types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";
import {
  KIND_AGENT_PROFILE,
  TAG_D2A_PROFILE,
  TAG_D2A_INTEREST,
  TAG_D2A_CAPACITY,
  TAG_D2A_PRINCIPAL,
  RESONANCE_THRESHOLD,
  PEER_EXPIRY_MS,
} from "./protocol";
import { errMsg } from "@/lib/utils/errors";
import { buildManifest, decodeManifest } from "@/lib/d2a/manifest";

/** Returns 0-1 Jaccard similarity of high-affinity topics vs peer interests. */
export function calculateResonance(
  myPrefs: UserPreferenceProfile,
  theirProfile: AgentProfile,
): number {
  const myHighTopics = Object.entries(myPrefs.topicAffinities)
    .filter(([, v]) => v >= 0.3)
    .map(([k]) => k);

  if (myHighTopics.length === 0 || theirProfile.interests.length === 0) return 0;

  const theirSet = new Set(theirProfile.interests);
  let overlap = 0;
  for (const topic of myHighTopics) {
    if (theirSet.has(topic)) overlap++;
  }

  // Jaccard similarity: |intersection| / |union|
  const union = theirSet.size + myHighTopics.length - overlap;
  return union > 0 ? overlap / union : 0;
}

/** NIP-78 replaceable event (Kind 30078). */
export async function broadcastPresence(
  sk: Uint8Array,
  interests: string[],
  capacity: number,
  relayUrls: string[],
  principalId?: string,
  contentItems?: ContentItem[],
): Promise<void> {
  const tags: string[][] = [
    ["d", TAG_D2A_PROFILE],
    [TAG_D2A_CAPACITY, capacity.toString()],
  ];
  if (principalId) {
    tags.push([TAG_D2A_PRINCIPAL, principalId]);
  }
  for (const interest of interests.slice(0, 20)) {
    tags.push([TAG_D2A_INTEREST, interest]);
  }

  const manifestContent = contentItems && contentItems.length > 0
    ? JSON.stringify(buildManifest(contentItems))
    : "";

  const template: EventTemplate = {
    kind: KIND_AGENT_PROFILE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: manifestContent,
  };

  const signed = finalizeEvent(template, sk);

  const pool = new SimplePool();
  const promises = pool.publish(relayUrls, signed);
  const results = await Promise.allSettled(promises);
  pool.destroy();

  const succeeded = results.filter(r => r.status === "fulfilled").length;
  if (succeeded === 0 && relayUrls.length > 0) {
    throw new Error(`Presence broadcast failed on all ${relayUrls.length} relays`);
  }
}

export async function discoverPeers(
  myPubkey: string,
  myPrefs: UserPreferenceProfile,
  relayUrls: string[],
): Promise<AgentProfile[]> {
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
  } catch (err) {
    console.error("[discovery] Relay query failed:", errMsg(err));
    pool.destroy();
    return [];
  }
  pool.destroy();

  const byPubkey = new Map<string, AgentProfile>();

  for (const ev of events) {
    if (ev.pubkey === myPubkey) continue;

    const existing = byPubkey.get(ev.pubkey);
    if (existing && existing.lastSeen >= ev.created_at * 1000) continue;

    const interests: string[] = [];
    let capacity = 5;
    let principalId: string | undefined;

    for (const tag of ev.tags) {
      if (tag[0] === TAG_D2A_INTEREST && tag[1]) {
        interests.push(tag[1]);
      }
      if (tag[0] === TAG_D2A_CAPACITY && tag[1]) {
        const parsed = parseInt(tag[1], 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) {
          capacity = parsed;
        }
      }
      if (tag[0] === TAG_D2A_PRINCIPAL && tag[1]) {
        principalId = tag[1];
      }
    }

    let manifest;
    if (ev.content && ev.content.length > 0) {
      manifest = decodeManifest(ev.content) || undefined;
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

  return Array.from(byPubkey.values())
    .filter(p => (p.resonance ?? 0) >= RESONANCE_THRESHOLD)
    .sort((a, b) => (b.resonance ?? 0) - (a.resonance ?? 0));
}
