import { finalizeEvent } from "nostr-tools/pure";
import { encryptMessage, decryptMessage } from "@/lib/nostr/encrypt";
import { publishAndPartition } from "@/lib/nostr/publish";
import type { HandshakeState, D2AOfferPayload, D2ADeliverPayload, D2AMessage } from "./types";
import {
  KIND_EPHEMERAL,
  TAG_D2A_OFFER,
  TAG_D2A_ACCEPT,
  TAG_D2A_REJECT,
  TAG_D2A_DELIVER,
  HANDSHAKE_TIMEOUT_MS,
} from "./protocol";

const D2A_TAG_MAP: Record<D2AMessage["type"], string> = {
  offer: TAG_D2A_OFFER,
  accept: TAG_D2A_ACCEPT,
  reject: TAG_D2A_REJECT,
  deliver: TAG_D2A_DELIVER,
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

const VALID_D2A_TYPES = new Set<D2AMessage["type"]>(["offer", "accept", "reject", "deliver"]);

function isValidOfferPayload(p: unknown): p is D2AOfferPayload {
  return !!p && typeof p === "object" &&
    typeof (p as D2AOfferPayload).topic === "string" &&
    typeof (p as D2AOfferPayload).score === "number" &&
    typeof (p as D2AOfferPayload).contentPreview === "string";
}

function isValidDeliverPayload(p: unknown): p is D2ADeliverPayload {
  return !!p && typeof p === "object" &&
    typeof (p as D2ADeliverPayload).text === "string" &&
    typeof (p as D2ADeliverPayload).author === "string" &&
    typeof (p as D2ADeliverPayload).verdict === "string" &&
    Array.isArray((p as D2ADeliverPayload).topics);
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
      case "accept":
        return { type, fromPubkey, toPubkey, payload: {} };
      case "reject":
        return { type, fromPubkey, toPubkey, payload: {} };
      default:
        return null;
    }
  } catch (err) {
    console.warn("[handshake] Failed to parse D2A message from", senderPk.slice(0, 8) + "...:", err instanceof SyntaxError ? "invalid JSON" : "decrypt failed");
    return null;
  }
}

export function isHandshakeExpired(handshake: HandshakeState): boolean {
  return Date.now() - handshake.startedAt > HANDSHAKE_TIMEOUT_MS;
}
