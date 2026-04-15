import { finalizeEvent } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { encryptMessage, decryptMessage } from "./encrypt";
import {
  KIND_EPHEMERAL,
  TAG_D2A_OFFER,
  TAG_D2A_ACCEPT,
  TAG_D2A_REJECT,
  TAG_D2A_DELIVER,
  TAG_D2A_COMMENT,
  MAX_COMMENT_LENGTH,
  MAX_PREVIEW_LENGTH,
  MAX_DELIVER_TEXT_LENGTH,
  MAX_TOPIC_LENGTH,
  MAX_TOPICS_COUNT,
  HANDSHAKE_TIMEOUT_MS,
} from "./protocol";
import type {
  D2AMessage,
  D2AOfferPayload,
  D2ADeliverPayload,
  D2ACommentPayload,
  HandshakeState,
} from "./types";

const D2A_TAG_MAP: Record<D2AMessage["type"], string> = {
  offer: TAG_D2A_OFFER,
  accept: TAG_D2A_ACCEPT,
  reject: TAG_D2A_REJECT,
  deliver: TAG_D2A_DELIVER,
  comment: TAG_D2A_COMMENT,
};

export interface PublishResult {
  /** Relay URLs that confirmed publication. */
  published: string[];
  /** Relay URLs that rejected or errored. */
  failed: string[];
}

async function publishAndPartition(
  signed: ReturnType<typeof finalizeEvent>,
  relayUrls: string[],
): Promise<PublishResult> {
  const pool = new SimplePool();
  try {
    const settled = await Promise.allSettled(pool.publish(relayUrls, signed));
    const published: string[] = [];
    const failed: string[] = [];
    settled.forEach((r, i) => {
      const url = relayUrls[i];
      if (!url) return;
      if (r.status === "fulfilled") published.push(url);
      else failed.push(url);
    });
    return { published, failed };
  } finally {
    pool.destroy();
  }
}

async function sendD2AMessage(
  sk: Uint8Array,
  peerPubkey: string,
  message: D2AMessage,
  relayUrls: string[],
): Promise<PublishResult> {
  const encrypted = encryptMessage(JSON.stringify(message), sk, peerPubkey);
  const signed = finalizeEvent(
    {
      kind: KIND_EPHEMERAL,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", peerPubkey],
        ["d2a", D2A_TAG_MAP[message.type]],
      ],
      content: encrypted,
    },
    sk,
  );

  const result = await publishAndPartition(signed, relayUrls);
  if (result.published.length === 0) {
    throw new Error(
      `D2A ${message.type} to ${peerPubkey.slice(0, 8)}... failed on all ${relayUrls.length} relays`,
    );
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
  await sendD2AMessage(
    sk,
    peerPubkey,
    { type: "offer", fromPubkey: myPubkey, toPubkey: peerPubkey, payload: offer },
    relayUrls,
  );
  return {
    peerId: peerPubkey,
    phase: "offered",
    offeredTopic: offer.topic,
    offeredScore: offer.score,
    startedAt: Date.now(),
  };
}

export async function sendAccept(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  relayUrls: string[],
): Promise<PublishResult> {
  return sendD2AMessage(
    sk,
    peerPubkey,
    { type: "accept", fromPubkey: myPubkey, toPubkey: peerPubkey, payload: {} },
    relayUrls,
  );
}

export async function sendReject(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  relayUrls: string[],
): Promise<PublishResult> {
  return sendD2AMessage(
    sk,
    peerPubkey,
    { type: "reject", fromPubkey: myPubkey, toPubkey: peerPubkey, payload: {} },
    relayUrls,
  );
}

export async function deliverContent(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  content: D2ADeliverPayload,
  relayUrls: string[],
): Promise<PublishResult> {
  return sendD2AMessage(
    sk,
    peerPubkey,
    { type: "deliver", fromPubkey: myPubkey, toPubkey: peerPubkey, payload: content },
    relayUrls,
  );
}

export async function sendComment(
  sk: Uint8Array,
  myPubkey: string,
  peerPubkey: string,
  payload: D2ACommentPayload,
  relayUrls: string[],
): Promise<PublishResult> {
  return sendD2AMessage(
    sk,
    peerPubkey,
    { type: "comment", fromPubkey: myPubkey, toPubkey: peerPubkey, payload },
    relayUrls,
  );
}

const VALID_D2A_TYPES = new Set<D2AMessage["type"]>([
  "offer",
  "accept",
  "reject",
  "deliver",
  "comment",
]);
const VALID_VERDICTS = new Set(["quality", "slop"]);

function isFiniteScore(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10;
}

function isValidOfferPayload(p: unknown): p is D2AOfferPayload {
  if (!p || typeof p !== "object") return false;
  const o = p as D2AOfferPayload;
  return (
    typeof o.topic === "string" &&
    o.topic.length > 0 &&
    o.topic.length <= MAX_TOPIC_LENGTH &&
    isFiniteScore(o.score) &&
    typeof o.contentPreview === "string" &&
    o.contentPreview.length <= MAX_PREVIEW_LENGTH
  );
}

function isValidDeliverPayload(p: unknown): p is D2ADeliverPayload {
  if (!p || typeof p !== "object") return false;
  const d = p as D2ADeliverPayload;
  if (
    typeof d.text !== "string" ||
    d.text.length === 0 ||
    d.text.length > MAX_DELIVER_TEXT_LENGTH ||
    typeof d.author !== "string" ||
    d.author.length === 0 ||
    d.author.length > 200 ||
    typeof d.verdict !== "string" ||
    !VALID_VERDICTS.has(d.verdict) ||
    !Array.isArray(d.topics) ||
    d.topics.length > MAX_TOPICS_COUNT ||
    !d.topics.every(t => typeof t === "string" && t.length <= MAX_TOPIC_LENGTH)
  ) {
    return false;
  }
  if (!d.scores || typeof d.scores !== "object") return false;
  return (
    isFiniteScore(d.scores.originality) &&
    isFiniteScore(d.scores.insight) &&
    isFiniteScore(d.scores.credibility) &&
    isFiniteScore(d.scores.composite)
  );
}

function isValidCommentPayload(p: unknown): p is D2ACommentPayload {
  if (!p || typeof p !== "object") return false;
  const c = p as D2ACommentPayload;
  return (
    typeof c.contentHash === "string" &&
    typeof c.contentTitle === "string" &&
    typeof c.comment === "string" &&
    c.comment.length <= MAX_COMMENT_LENGTH &&
    typeof c.timestamp === "number"
  );
}

/**
 * Decrypt and validate an inbound D2A message. Returns null on:
 *  - decryption failure
 *  - JSON parse failure
 *  - any validator rejecting the payload
 *  - inner `fromPubkey` mismatching the outer event signer
 *
 * Returning null (not throwing) is intentional — malformed peer traffic is
 * not an error condition for the receiver.
 */
export function parseD2AMessage(
  encryptedContent: string,
  recipientSk: Uint8Array,
  senderPk: string,
): D2AMessage | null {
  let decrypted: string;
  try {
    decrypted = decryptMessage(encryptedContent, recipientSk, senderPk);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const m = parsed as D2AMessage & { type: D2AMessage["type"] };
  if (
    !VALID_D2A_TYPES.has(m.type) ||
    typeof m.fromPubkey !== "string" ||
    typeof m.toPubkey !== "string" ||
    !("payload" in m)
  ) {
    return null;
  }
  if (m.fromPubkey !== senderPk) return null;

  switch (m.type) {
    case "offer":
      return isValidOfferPayload(m.payload) ? m : null;
    case "deliver":
      return isValidDeliverPayload(m.payload) ? m : null;
    case "comment":
      return isValidCommentPayload(m.payload) ? m : null;
    case "accept":
      return { type: "accept", fromPubkey: m.fromPubkey, toPubkey: m.toPubkey, payload: {} };
    case "reject":
      return { type: "reject", fromPubkey: m.fromPubkey, toPubkey: m.toPubkey, payload: {} };
    default:
      return null;
  }
}

export function isHandshakeExpired(handshake: HandshakeState): boolean {
  return Date.now() - handshake.startedAt > HANDSHAKE_TIMEOUT_MS;
}
