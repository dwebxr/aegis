import {
  encryptMessage,
  decryptMessage,
} from "../src/encrypt";
import { parseD2AMessage } from "../src/handshake";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { D2AMessage } from "../src/types";

function makeKeyPair(): { sk: Uint8Array; pk: string } {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

function encrypt(message: D2AMessage, senderSk: Uint8Array, recipientPk: string): string {
  return encryptMessage(JSON.stringify(message), senderSk, recipientPk);
}

describe("parseD2AMessage — round-trip + validation", () => {
  it("decrypts and validates a well-formed offer", () => {
    const sender = makeKeyPair();
    const recipient = makeKeyPair();
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: sender.pk,
      toPubkey: recipient.pk,
      payload: { topic: "rust", score: 9.0, contentPreview: "Hello world" },
    };
    const ciphertext = encrypt(msg, sender.sk, recipient.pk);
    const parsed = parseD2AMessage(ciphertext, recipient.sk, sender.pk);
    expect(parsed).toEqual(msg);
  });

  it("returns null when inner fromPubkey mismatches outer signer", () => {
    const sender = makeKeyPair();
    const impostor = makeKeyPair();
    const recipient = makeKeyPair();
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: impostor.pk, // claims to be impostor
      toPubkey: recipient.pk,
      payload: { topic: "rust", score: 9.0, contentPreview: "x" },
    };
    const ciphertext = encrypt(msg, sender.sk, recipient.pk);
    const parsed = parseD2AMessage(ciphertext, recipient.sk, sender.pk);
    expect(parsed).toBeNull();
  });

  it("rejects offer payloads with score out of [0, 10]", () => {
    const sender = makeKeyPair();
    const recipient = makeKeyPair();
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: sender.pk,
      toPubkey: recipient.pk,
      payload: { topic: "rust", score: 11, contentPreview: "x" },
    };
    const ciphertext = encrypt(msg, sender.sk, recipient.pk);
    expect(parseD2AMessage(ciphertext, recipient.sk, sender.pk)).toBeNull();
  });

  it("rejects deliver payloads with text exceeding the 5000-char limit", () => {
    const sender = makeKeyPair();
    const recipient = makeKeyPair();
    const msg: D2AMessage = {
      type: "deliver",
      fromPubkey: sender.pk,
      toPubkey: recipient.pk,
      payload: {
        text: "x".repeat(5001),
        author: "Author",
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
        verdict: "quality",
        topics: ["t"],
      },
    };
    const ciphertext = encrypt(msg, sender.sk, recipient.pk);
    expect(parseD2AMessage(ciphertext, recipient.sk, sender.pk)).toBeNull();
  });

  it("accepts a well-formed deliver", () => {
    const sender = makeKeyPair();
    const recipient = makeKeyPair();
    const msg: D2AMessage = {
      type: "deliver",
      fromPubkey: sender.pk,
      toPubkey: recipient.pk,
      payload: {
        text: "ok",
        author: "Author",
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
        verdict: "quality",
        topics: ["t1", "t2"],
        vSignal: 8,
      },
    };
    const ciphertext = encrypt(msg, sender.sk, recipient.pk);
    expect(parseD2AMessage(ciphertext, recipient.sk, sender.pk)).toEqual(msg);
  });

  it("rejects comment payloads exceeding 280 chars", () => {
    const sender = makeKeyPair();
    const recipient = makeKeyPair();
    const msg: D2AMessage = {
      type: "comment",
      fromPubkey: sender.pk,
      toPubkey: recipient.pk,
      payload: {
        contentHash: "h",
        contentTitle: "T",
        comment: "x".repeat(281),
        timestamp: Date.now(),
      },
    };
    const ciphertext = encrypt(msg, sender.sk, recipient.pk);
    expect(parseD2AMessage(ciphertext, recipient.sk, sender.pk)).toBeNull();
  });

  it("returns null on garbage ciphertext (decryption failure)", () => {
    const recipient = makeKeyPair();
    const sender = makeKeyPair();
    expect(parseD2AMessage("not real ciphertext", recipient.sk, sender.pk)).toBeNull();
  });

  it("returns null on unknown message type", () => {
    const sender = makeKeyPair();
    const recipient = makeKeyPair();
    const ciphertext = encryptMessage(
      JSON.stringify({ type: "ping", fromPubkey: sender.pk, toPubkey: recipient.pk, payload: {} }),
      sender.sk,
      recipient.pk,
    );
    expect(parseD2AMessage(ciphertext, recipient.sk, sender.pk)).toBeNull();
  });
});

describe("encryptMessage / decryptMessage round-trip", () => {
  it("decrypts to the same plaintext when used by both peers correctly", () => {
    const sender = makeKeyPair();
    const recipient = makeKeyPair();
    const cipher = encryptMessage("hello D2A", sender.sk, recipient.pk);
    expect(decryptMessage(cipher, recipient.sk, sender.pk)).toBe("hello D2A");
  });
});
