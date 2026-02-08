import { finalizeEvent } from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { encryptMessage, decryptMessage } from "@/lib/nostr/encrypt";
import type { HandshakeState, D2AOfferPayload, D2ADeliverPayload, D2AMessage } from "./types";
import {
  KIND_EPHEMERAL,
  TAG_D2A_OFFER,
  TAG_D2A_ACCEPT,
  TAG_D2A_REJECT,
  TAG_D2A_DELIVER,
  HANDSHAKE_TIMEOUT_MS,
} from "./protocol";

interface RelayResult {
  published: string[];
  failed: string[];
}

async function publishToRelays(
  sk: Uint8Array,
  template: EventTemplate,
  relayUrls: string[],
): Promise<RelayResult> {
  const signed = finalizeEvent(template, sk);
  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(relayUrls, signed));
  pool.destroy();

  const published: string[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      published.push(relayUrls[i]);
    } else {
      console.warn(`Relay ${relayUrls[i]} publish failed:`, result.reason);
      failed.push(relayUrls[i]);
    }
  });

  return { published, failed };
}

async function sendD2AMessage(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  type: D2AMessage["type"],
  tag: string,
  payload: D2AMessage["payload"],
  relayUrls: string[],
): Promise<RelayResult> {
  const message: D2AMessage = { type, fromPubkey: myPubkey, toPubkey: peerPubkey, payload };
  const encrypted = encryptMessage(JSON.stringify(message), sk, peerPubkey);

  const template: EventTemplate = {
    kind: KIND_EPHEMERAL,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["p", peerPubkey], ["d2a", tag]],
    content: encrypted,
  };

  const result = await publishToRelays(sk, template, relayUrls);
  if (result.published.length === 0) {
    console.warn(`D2A ${type} to ${peerPubkey} failed on all relays`);
  }
  return result;
}

export async function sendOffer(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  offer: D2AOfferPayload,
  relayUrls: string[],
): Promise<HandshakeState> {
  await sendD2AMessage(sk, myPubkey, peerPubkey, "offer", TAG_D2A_OFFER, offer, relayUrls);
  return {
    peerId: peerPubkey,
    phase: "offered",
    offeredTopic: offer.topic,
    offeredScore: offer.score,
    startedAt: Date.now(),
  };
}

export async function sendAccept(
  sk: Uint8Array, myPubkey: string, peerPubkey: string, relayUrls: string[],
): Promise<RelayResult> {
  return sendD2AMessage(sk, myPubkey, peerPubkey, "accept", TAG_D2A_ACCEPT, {}, relayUrls);
}

export async function sendReject(
  sk: Uint8Array, myPubkey: string, peerPubkey: string, relayUrls: string[],
): Promise<RelayResult> {
  return sendD2AMessage(sk, myPubkey, peerPubkey, "reject", TAG_D2A_REJECT, {}, relayUrls);
}

export async function deliverContent(
  sk: Uint8Array, myPubkey: string, peerPubkey: string, content: D2ADeliverPayload, relayUrls: string[],
): Promise<RelayResult> {
  return sendD2AMessage(sk, myPubkey, peerPubkey, "deliver", TAG_D2A_DELIVER, content, relayUrls);
}

export function parseD2AMessage(
  encryptedContent: string,
  recipientSk: Uint8Array,
  senderPk: string,
): D2AMessage | null {
  try {
    const decrypted = decryptMessage(encryptedContent, recipientSk, senderPk);
    return JSON.parse(decrypted) as D2AMessage;
  } catch {
    return null;
  }
}

export function isHandshakeExpired(handshake: HandshakeState): boolean {
  return Date.now() - handshake.startedAt > HANDSHAKE_TIMEOUT_MS;
}
