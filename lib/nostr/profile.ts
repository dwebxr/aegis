import { finalizeEvent } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { KIND_PROFILE, KIND_RELAY_LIST, DEFAULT_RELAYS } from "./types";
import { publishAndPartition, type PublishResult } from "./publish";
import { withTimeout } from "@/lib/utils/timeout";
import { errMsg } from "@/lib/utils/errors";

export interface NostrProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  lud16?: string;
  nip05?: string;
  [key: string]: unknown;
}

const CACHE_PREFIX = "aegis-agent-profile-";

export function getCachedAgentProfile(principalText: string): NostrProfileMetadata | null {
  if (typeof globalThis.localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + principalText);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as NostrProfileMetadata;
  } catch (err) {
    console.warn("[agent-profile] Failed to parse cached profile:", errMsg(err));
    return null;
  }
}

export function setCachedAgentProfile(principalText: string, profile: NostrProfileMetadata): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_PREFIX + principalText, JSON.stringify(profile));
  } catch (err) {
    console.warn("[agent-profile] Failed to cache profile:", errMsg(err));
  }
}

export function clearCachedAgentProfile(principalText: string): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.removeItem(CACHE_PREFIX + principalText);
  } catch (err) {
    console.warn("[agent-profile] Failed to clear cached profile:", errMsg(err));
  }
}

export async function fetchAgentProfile(
  pubkeyHex: string,
  relayUrls?: string[],
): Promise<NostrProfileMetadata | null> {
  const pool = new SimplePool();
  try {
    const urls = relayUrls?.length ? relayUrls : DEFAULT_RELAYS;
    const events = await withTimeout(
      pool.querySync(urls, { authors: [pubkeyHex], kinds: [KIND_PROFILE] }),
      10_000,
      "Profile relay query timed out",
    );

    if (events.length === 0) return null;

    // Pick latest event (highest created_at)
    let best = events[0];
    for (let i = 1; i < events.length; i++) {
      if (events[i].created_at > best.created_at) best = events[i];
    }

    try {
      const meta = JSON.parse(best.content);
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
      return meta as NostrProfileMetadata;
    } catch {
      console.debug("[agent-profile] Malformed Kind 0 JSON for", pubkeyHex.slice(0, 8));
      return null;
    }
  } finally {
    pool.destroy();
  }
}

/** Merge-on-write: fetches existing Kind 0, merges new fields, publishes to relays */
export async function publishAgentProfile(
  profile: NostrProfileMetadata,
  sk: Uint8Array,
  pubkeyHex: string,
  relayUrls?: string[],
): Promise<PublishResult & { mergedProfile: NostrProfileMetadata }> {
  const urls = relayUrls?.length ? relayUrls : DEFAULT_RELAYS;

  // Preserve fields set by other clients
  let existing: NostrProfileMetadata = {};
  try {
    const fetched = await fetchAgentProfile(pubkeyHex, urls);
    if (fetched) existing = fetched;
  } catch (err) {
    console.warn("[agent-profile] Existing Kind 0 fetch failed — merging with empty, existing fields may be lost:", errMsg(err));
  }

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(profile)) {
    if (value === undefined) continue;
    if (value === "") {
      delete merged[key]; // empty string = clear field
    } else {
      merged[key] = value;
    }
  }

  const signed = finalizeEvent(
    {
      kind: KIND_PROFILE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(merged),
    },
    sk,
  );

  const { published, failed } = await publishAndPartition(signed, urls);

  if (published.length > 0) {
    // Publish Kind 10002 (NIP-65 Relay List Metadata) so other clients
    // know where to find this pubkey's events
    try {
      const relayListEvent = finalizeEvent(
        {
          kind: KIND_RELAY_LIST,
          created_at: Math.floor(Date.now() / 1000),
          tags: urls.map((u) => ["r", u]),
          content: "",
        },
        sk,
      );
      await publishAndPartition(relayListEvent, urls);
    } catch (err) {
      console.warn("[agent-profile] Kind 10002 relay list publish failed:", errMsg(err));
    }

    // Verify the profile was stored by fetching it back
    try {
      const verified = await fetchAgentProfile(pubkeyHex, published.slice(0, 1));
      if (!verified) {
        console.warn("[agent-profile] Post-publish verification: relay returned no Kind 0");
      }
    } catch (err) {
      console.warn("[agent-profile] Post-publish verification failed:", errMsg(err));
    }
  }

  return {
    eventId: signed.id,
    relaysPublished: published,
    relaysFailed: failed,
    mergedProfile: merged as NostrProfileMetadata,
  };
}
