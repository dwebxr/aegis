import { finalizeEvent } from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { KIND_TEXT_NOTE } from "./types";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

export interface PublishResult {
  eventId: string;
  relaysPublished: string[];
  relaysFailed: string[];
}

/**
 * Sign and publish a Nostr event to configured relays.
 * Done entirely client-side — the private key never leaves the browser.
 */
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

/**
 * Build Aegis-standard tags for a signal event.
 */
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
