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

/**
 * Send a content offer to a peer.
 * "I have content about {topic} scoring {score}. Want it?"
 */
export async function sendOffer(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  offer: D2AOfferPayload,
  relayUrls: string[],
): Promise<HandshakeState> {
  const message: D2AMessage = {
    type: "offer",
    fromPubkey: myPubkey,
    toPubkey: peerPubkey,
    payload: offer,
  };

  const encrypted = encryptMessage(JSON.stringify(message), sk, peerPubkey);

  const template: EventTemplate = {
    kind: KIND_EPHEMERAL,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", peerPubkey],
      ["d2a", TAG_D2A_OFFER],
    ],
    content: encrypted,
  };

  const signed = finalizeEvent(template, sk);

  const pool = new SimplePool();
  await Promise.allSettled(pool.publish(relayUrls, signed));
  pool.destroy();

  return {
    peerId: peerPubkey,
    phase: "offered",
    offeredTopic: offer.topic,
    offeredScore: offer.score,
    startedAt: Date.now(),
  };
}

/**
 * Send acceptance of a content offer.
 */
export async function sendAccept(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  relayUrls: string[],
): Promise<void> {
  const message: D2AMessage = {
    type: "accept",
    fromPubkey: myPubkey,
    toPubkey: peerPubkey,
    payload: {},
  };

  const encrypted = encryptMessage(JSON.stringify(message), sk, peerPubkey);

  const template: EventTemplate = {
    kind: KIND_EPHEMERAL,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", peerPubkey],
      ["d2a", TAG_D2A_ACCEPT],
    ],
    content: encrypted,
  };

  const signed = finalizeEvent(template, sk);

  const pool = new SimplePool();
  await Promise.allSettled(pool.publish(relayUrls, signed));
  pool.destroy();
}

/**
 * Send rejection of a content offer.
 */
export async function sendReject(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  relayUrls: string[],
): Promise<void> {
  const message: D2AMessage = {
    type: "reject",
    fromPubkey: myPubkey,
    toPubkey: peerPubkey,
    payload: {},
  };

  const encrypted = encryptMessage(JSON.stringify(message), sk, peerPubkey);

  const template: EventTemplate = {
    kind: KIND_EPHEMERAL,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", peerPubkey],
      ["d2a", TAG_D2A_REJECT],
    ],
    content: encrypted,
  };

  const signed = finalizeEvent(template, sk);

  const pool = new SimplePool();
  await Promise.allSettled(pool.publish(relayUrls, signed));
  pool.destroy();
}

/**
 * Deliver full content to a peer (NIP-44 encrypted).
 */
export async function deliverContent(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  content: D2ADeliverPayload,
  relayUrls: string[],
): Promise<void> {
  const message: D2AMessage = {
    type: "deliver",
    fromPubkey: myPubkey,
    toPubkey: peerPubkey,
    payload: content,
  };

  const encrypted = encryptMessage(JSON.stringify(message), sk, peerPubkey);

  const template: EventTemplate = {
    kind: KIND_EPHEMERAL,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", peerPubkey],
      ["d2a", TAG_D2A_DELIVER],
    ],
    content: encrypted,
  };

  const signed = finalizeEvent(template, sk);

  const pool = new SimplePool();
  await Promise.allSettled(pool.publish(relayUrls, signed));
  pool.destroy();
}

/**
 * Parse an incoming D2A message (decrypt + decode).
 */
export function parseD2AMessage(
  encryptedContent: string,
  recipientSk: Uint8Array,
  senderPk: string,
): D2AMessage | null {
  const decrypted = decryptMessage(encryptedContent, recipientSk, senderPk);
  return JSON.parse(decrypted) as D2AMessage;
}

/**
 * Check if a handshake has timed out.
 */
export function isHandshakeExpired(handshake: HandshakeState): boolean {
  return Date.now() - handshake.startedAt > HANDSHAKE_TIMEOUT_MS;
}
