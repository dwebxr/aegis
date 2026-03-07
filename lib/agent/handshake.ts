import { finalizeEvent } from "nostr-tools/pure";
import { encryptMessage, decryptMessage } from "@/lib/nostr/encrypt";
import { publishAndPartition } from "@/lib/nostr/publish";
import { errMsg } from "@/lib/utils/errors";
import type { HandshakeState, D2AOfferPayload, D2ADeliverPayload, D2ACommentPayload, D2AMessage } from "./types";
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

const D2A_TAG_MAP: Record<D2AMessage["type"], string> = {
  offer: TAG_D2A_OFFER,
  accept: TAG_D2A_ACCEPT,
  reject: TAG_D2A_REJECT,
  deliver: TAG_D2A_DELIVER,
  comment: TAG_D2A_COMMENT,
};

async function sendD2AMessage(
  sk: Uint8Array,
  peerPubkey: string,
  message: D2AMessage,
  relayUrls: string[],
): Promise<{ published: string[]; failed: string[] }> {
  const encrypted = encryptMessage(JSON.stringify(message), sk, peerPubkey);

  const signed = finalizeEvent(
    {
      kind: KIND_EPHEMERAL,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", peerPubkey], ["d2a", D2A_TAG_MAP[message.type]]],
      content: encrypted,
    },
    sk,
  );

  const result = await publishAndPartition(signed, relayUrls);
  if (result.published.length === 0) {
    throw new Error(`D2A ${message.type} to ${peerPubkey.slice(0, 8)}... failed on all ${relayUrls.length} relays`);
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
  await sendD2AMessage(sk, peerPubkey, { type: "offer", fromPubkey: myPubkey, toPubkey: peerPubkey, payload: offer }, relayUrls);
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
): Promise<{ published: string[]; failed: string[] }> {
  return sendD2AMessage(sk, peerPubkey, { type: "accept", fromPubkey: myPubkey, toPubkey: peerPubkey, payload: {} }, relayUrls);
}

export async function sendReject(
  sk: Uint8Array, myPubkey: string, peerPubkey: string, relayUrls: string[],
): Promise<{ published: string[]; failed: string[] }> {
  return sendD2AMessage(sk, peerPubkey, { type: "reject", fromPubkey: myPubkey, toPubkey: peerPubkey, payload: {} }, relayUrls);
}

export async function deliverContent(
  sk: Uint8Array, myPubkey: string, peerPubkey: string, content: D2ADeliverPayload, relayUrls: string[],
): Promise<{ published: string[]; failed: string[] }> {
  return sendD2AMessage(sk, peerPubkey, { type: "deliver", fromPubkey: myPubkey, toPubkey: peerPubkey, payload: content }, relayUrls);
}

export async function sendComment(
  sk: Uint8Array, myPubkey: string, peerPubkey: string, payload: D2ACommentPayload, relayUrls: string[],
): Promise<{ published: string[]; failed: string[] }> {
  return sendD2AMessage(sk, peerPubkey, { type: "comment", fromPubkey: myPubkey, toPubkey: peerPubkey, payload }, relayUrls);
}

const VALID_D2A_TYPES = new Set<D2AMessage["type"]>(["offer", "accept", "reject", "deliver", "comment"]);

function isValidOfferPayload(p: unknown): p is D2AOfferPayload {
  if (!p || typeof p !== "object") return false;
  const o = p as D2AOfferPayload;
  return typeof o.topic === "string" && o.topic.length > 0 && o.topic.length <= MAX_TOPIC_LENGTH &&
    typeof o.score === "number" && Number.isFinite(o.score) && o.score >= 0 && o.score <= 10 &&
    typeof o.contentPreview === "string" && o.contentPreview.length <= MAX_PREVIEW_LENGTH;
}

const VALID_VERDICTS = new Set(["quality", "slop"]);

function isValidScore(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10;
}

function isValidDeliverPayload(p: unknown): p is D2ADeliverPayload {
  if (!p || typeof p !== "object") return false;
  const d = p as D2ADeliverPayload;
  if (
    typeof d.text !== "string" || d.text.length === 0 || d.text.length > MAX_DELIVER_TEXT_LENGTH ||
    typeof d.author !== "string" || d.author.length === 0 || d.author.length > 200 ||
    typeof d.verdict !== "string" || !VALID_VERDICTS.has(d.verdict) ||
    !Array.isArray(d.topics) || d.topics.length > MAX_TOPICS_COUNT ||
    !d.topics.every((t: unknown) => typeof t === "string" && t.length <= MAX_TOPIC_LENGTH)
  ) return false;
  if (!d.scores || typeof d.scores !== "object") return false;
  const s = d.scores as unknown as Record<string, unknown>;
  return isValidScore(s.originality) && isValidScore(s.insight) &&
    isValidScore(s.credibility) && isValidScore(s.composite);
}

function isValidCommentPayload(p: unknown): p is D2ACommentPayload {
  if (!p || typeof p !== "object") return false;
  const c = p as D2ACommentPayload;
  return typeof c.contentHash === "string" &&
    typeof c.contentTitle === "string" &&
    typeof c.comment === "string" &&
    c.comment.length <= MAX_COMMENT_LENGTH &&
    typeof c.timestamp === "number";
}

export function parseD2AMessage(
  encryptedContent: string,
  recipientSk: Uint8Array,
  senderPk: string,
): D2AMessage | null {
  try {
    const decrypted = decryptMessage(encryptedContent, recipientSk, senderPk);
    const parsed = JSON.parse(decrypted);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !VALID_D2A_TYPES.has(parsed.type) ||
      typeof parsed.fromPubkey !== "string" ||
      typeof parsed.toPubkey !== "string" ||
      !("payload" in parsed)
    ) {
      console.warn("[handshake] Malformed D2A message from", senderPk.slice(0, 8) + "...: missing required fields");
      return null;
    }

    if (parsed.fromPubkey !== senderPk) {
      console.warn("[handshake] Sender pubkey mismatch: payload claims", parsed.fromPubkey.slice(0, 8) + "... but event from", senderPk.slice(0, 8) + "...");
      return null;
    }

    const { type, fromPubkey, toPubkey, payload } = parsed;

    switch (type) {
      case "offer":
        if (!isValidOfferPayload(payload)) {
          console.warn("[handshake] Invalid offer payload from", senderPk.slice(0, 8) + "...");
          return null;
        }
        return { type, fromPubkey, toPubkey, payload };
      case "deliver":
        if (!isValidDeliverPayload(payload)) {
          console.warn("[handshake] Invalid deliver payload from", senderPk.slice(0, 8) + "...");
          return null;
        }
        return { type, fromPubkey, toPubkey, payload };
      case "comment":
        if (!isValidCommentPayload(payload)) {
          console.warn("[handshake] Invalid comment payload from", senderPk.slice(0, 8) + "...");
          return null;
        }
        return { type, fromPubkey, toPubkey, payload };
      case "accept":
        return { type, fromPubkey, toPubkey, payload: {} };
      case "reject":
        return { type, fromPubkey, toPubkey, payload: {} };
      default:
        return null;
    }
  } catch (err) {
    const cause = err instanceof SyntaxError
      ? "invalid JSON in decrypted payload"
      : `decryption failed: ${errMsg(err)}`;
    console.warn("[handshake] Failed to parse D2A message from", senderPk.slice(0, 8) + "...:", cause);
    return null;
  }
}

export function isHandshakeExpired(handshake: HandshakeState): boolean {
  return Date.now() - handshake.startedAt > HANDSHAKE_TIMEOUT_MS;
}
