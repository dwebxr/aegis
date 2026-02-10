import { finalizeEvent } from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/pure";
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

/** Client-side only — private key never leaves the browser. */
export async function publishSignalToNostr(
  text: string,
  sk: Uint8Array,
  tags: string[][],
  relayUrls?: string[],
): Promise<PublishResult> {
  const template: EventTemplate = {
    kind: KIND_TEXT_NOTE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: text,
  };

  const signed = finalizeEvent(template, sk);

  const urls = relayUrls && relayUrls.length > 0 ? relayUrls : DEFAULT_RELAYS;
  const relaysPublished: string[] = [];
  const relaysFailed: string[] = [];

  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(urls, signed));
  pool.destroy();

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      relaysPublished.push(urls[i]);
    } else {
      relaysFailed.push(urls[i]);
    }
  });

  return {
    eventId: signed.id,
    relaysPublished,
    relaysFailed,
  };
}

export function buildAegisTags(
  composite: number,
  vSignal: number | undefined,
  topics: string[],
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
  return tags;
}

export interface BriefingPublishResult {
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
  const template: EventTemplate = {
    kind: KIND_LONG_FORM,
    created_at: Math.floor(Date.now() / 1000),
    tags: serialized.tags,
    content: serialized.content,
  };

  const signed = finalizeEvent(template, sk);

  const urls = relayUrls && relayUrls.length > 0 ? relayUrls : DEFAULT_RELAYS;
  const relaysPublished: string[] = [];
  const relaysFailed: string[] = [];

  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(urls, signed));
  pool.destroy();

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      relaysPublished.push(urls[i]);
    } else {
      relaysFailed.push(urls[i]);
    }
  });

  const addr: AddressPointer = {
    identifier: serialized.identifier,
    pubkey: pk,
    kind: KIND_LONG_FORM,
    relays: relaysPublished.length > 0 ? relaysPublished.slice(0, 2) : urls.slice(0, 2),
  };

  return {
    naddr: naddrEncode(addr),
    eventId: signed.id,
    relaysPublished,
    relaysFailed,
  };
}
