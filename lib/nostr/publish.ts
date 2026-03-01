import { finalizeEvent } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { naddrEncode } from "nostr-tools/nip19";
import type { AddressPointer } from "nostr-tools/nip19";
import { KIND_TEXT_NOTE, KIND_LONG_FORM, DEFAULT_RELAYS } from "./types";
import type { SerializedBriefing } from "@/lib/briefing/serialize";

export interface PublishResult {
  eventId: string;
  relaysPublished: string[];
  relaysFailed: string[];
}

export async function publishAndPartition(
  signed: ReturnType<typeof finalizeEvent>,
  urls: string[],
): Promise<{ published: string[]; failed: string[] }> {
  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(pool.publish(urls, signed));

    const published: string[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        published.push(urls[i]);
      } else {
        console.warn(`[nostr-publish] Relay ${urls[i]} rejected:`, r.reason);
        failed.push(urls[i]);
      }
    });
    return { published, failed };
  } finally {
    // Allow relay connections to flush before teardown
    await new Promise((r) => setTimeout(r, 1500));
    pool.destroy();
  }
}

/** Client-side only — private key never leaves the browser. */
export async function publishSignalToNostr(
  text: string,
  sk: Uint8Array,
  tags: string[][],
  relayUrls?: string[],
): Promise<PublishResult> {
  const signed = finalizeEvent(
    { kind: KIND_TEXT_NOTE, created_at: Math.floor(Date.now() / 1000), tags, content: text },
    sk,
  );

  const urls = relayUrls?.length ? relayUrls : DEFAULT_RELAYS;
  const { published, failed } = await publishAndPartition(signed, urls);

  return { eventId: signed.id, relaysPublished: published, relaysFailed: failed };
}

export function buildAegisTags(
  composite: number,
  vSignal: number | undefined,
  topics: string[],
  imageUrl?: string,
): string[][] {
  const tags: string[][] = [
    ["aegis", "v1"],
    ["aegis-score", composite.toFixed(1)],
    ["client", "aegis"],
  ];
  if (vSignal !== undefined) {
    tags.push(["aegis-vsignal", vSignal.toString()]);
  }
  for (const topic of topics) {
    tags.push(["t", topic]);
  }
  if (imageUrl) {
    tags.push(["imeta", `url ${imageUrl}`]);
  }
  return tags;
}

interface BriefingPublishResult {
  naddr: string;
  eventId: string;
  relaysPublished: string[];
  relaysFailed: string[];
}

/** Publish a serialized briefing as a NIP-23 long-form article (Kind 30023). */
export async function publishBriefingToNostr(
  serialized: SerializedBriefing,
  sk: Uint8Array,
  pk: string,
  relayUrls?: string[],
): Promise<BriefingPublishResult> {
  const signed = finalizeEvent(
    { kind: KIND_LONG_FORM, created_at: Math.floor(Date.now() / 1000), tags: serialized.tags, content: serialized.content },
    sk,
  );

  const urls = relayUrls?.length ? relayUrls : DEFAULT_RELAYS;
  const { published, failed } = await publishAndPartition(signed, urls);

  const addr: AddressPointer = {
    identifier: serialized.identifier,
    pubkey: pk,
    kind: KIND_LONG_FORM,
    relays: published.length > 0 ? published.slice(0, 2) : urls.slice(0, 2),
  };

  return { naddr: naddrEncode(addr), eventId: signed.id, relaysPublished: published, relaysFailed: failed };
}
