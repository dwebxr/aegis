/**
 * Tests for the five send* handshake helpers. SimplePool is mocked at the
 * relay boundary; encryption, signing, and tag construction run unmocked.
 */

const mockPublish = jest.fn<unknown[], unknown[]>();
const mockDestroy = jest.fn();

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    publish: mockPublish,
    destroy: mockDestroy,
  })),
}));

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  sendOffer,
  sendAccept,
  sendReject,
  deliverContent,
  sendComment,
} from "../src/handshake";
import { decryptMessage } from "../src/encrypt";
import { parseD2AMessage } from "../src/handshake";
import { TAG_D2A_OFFER, TAG_D2A_ACCEPT, TAG_D2A_REJECT, TAG_D2A_DELIVER, TAG_D2A_COMMENT, KIND_EPHEMERAL } from "../src/protocol";
import type { D2ADeliverPayload, D2ACommentPayload } from "../src/types";

interface SignedEvent { kind: number; tags: string[][]; content: string; pubkey: string; sig: string; id: string; created_at: number; }

const RELAYS = ["wss://r1", "wss://r2"];

function captureSignedEvent(): SignedEvent {
  expect(mockPublish).toHaveBeenCalledTimes(1);
  const [_relays, signed] = mockPublish.mock.calls[0] as [string[], SignedEvent];
  return signed;
}

beforeEach(() => {
  mockPublish.mockReset();
  mockDestroy.mockReset();
});

describe("sendOffer", () => {
  it("publishes an encrypted, signed event with the offer tag and returns a HandshakeState", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok"), Promise.resolve("ok")]);
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);

    const handshake = await sendOffer(
      senderSk,
      senderPk,
      recipientPk,
      { topic: "rust", score: 9.0, contentPreview: "preview text" },
      RELAYS,
    );

    expect(handshake.peerId).toBe(recipientPk);
    expect(handshake.phase).toBe("offered");
    expect(handshake.offeredTopic).toBe("rust");
    expect(handshake.offeredScore).toBe(9.0);
    expect(handshake.startedAt).toBeGreaterThan(0);

    const signed = captureSignedEvent();
    expect(signed.kind).toBe(KIND_EPHEMERAL);
    expect(signed.pubkey).toBe(senderPk);
    expect(signed.tags).toContainEqual(["p", recipientPk]);
    expect(signed.tags).toContainEqual(["d2a", TAG_D2A_OFFER]);

    // The recipient can decrypt + parse and recover the original payload.
    const parsed = parseD2AMessage(signed.content, recipientSk, senderPk);
    expect(parsed).toEqual({
      type: "offer",
      fromPubkey: senderPk,
      toPubkey: recipientPk,
      payload: { topic: "rust", score: 9.0, contentPreview: "preview text" },
    });

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("throws if every relay rejects publication", async () => {
    mockPublish.mockReturnValue([Promise.reject(new Error("relay 1 down")), Promise.reject(new Error("relay 2 down"))]);
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    await expect(
      sendOffer(sk, pk, getPublicKey(generateSecretKey()), { topic: "x", score: 5, contentPreview: "" }, RELAYS),
    ).rejects.toThrow(/failed on all 2 relays/);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("returns successfully when at least one relay accepts", async () => {
    mockPublish.mockReturnValue([Promise.reject(new Error("down")), Promise.resolve("ok")]);
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    await expect(
      sendOffer(sk, pk, getPublicKey(generateSecretKey()), { topic: "x", score: 5, contentPreview: "" }, RELAYS),
    ).resolves.toMatchObject({ phase: "offered" });
  });
});

describe("sendAccept / sendReject — empty payloads", () => {
  it("sendAccept emits the accept tag and an empty payload object", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok")]);
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);

    const result = await sendAccept(senderSk, senderPk, recipientPk, [RELAYS[0]]);
    expect(result.published).toEqual([RELAYS[0]]);
    expect(result.failed).toEqual([]);

    const signed = captureSignedEvent();
    expect(signed.tags).toContainEqual(["d2a", TAG_D2A_ACCEPT]);
    const parsed = parseD2AMessage(signed.content, recipientSk, senderPk);
    expect(parsed).toEqual({ type: "accept", fromPubkey: senderPk, toPubkey: recipientPk, payload: {} });
  });

  it("sendReject emits the reject tag", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok")]);
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    const recipientPk = getPublicKey(generateSecretKey());
    await sendReject(senderSk, senderPk, recipientPk, [RELAYS[0]]);
    const signed = captureSignedEvent();
    expect(signed.tags).toContainEqual(["d2a", TAG_D2A_REJECT]);
  });

  it("partitions published vs failed relays correctly", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok"), Promise.reject(new Error("x"))]);
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const result = await sendAccept(sk, pk, getPublicKey(generateSecretKey()), RELAYS);
    expect(result.published).toEqual([RELAYS[0]]);
    expect(result.failed).toEqual([RELAYS[1]]);
  });
});

describe("deliverContent", () => {
  it("encrypts a full deliver payload and signs with KIND_EPHEMERAL + deliver tag", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok")]);
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);

    const payload: D2ADeliverPayload = {
      text: "the article body",
      author: "Author",
      scores: { originality: 8, insight: 9, credibility: 9, composite: 8.7 },
      verdict: "quality",
      topics: ["rust", "ml"],
      vSignal: 9,
      cContext: 8,
      lSlop: 1,
    };
    await deliverContent(senderSk, senderPk, recipientPk, payload, [RELAYS[0]]);

    const signed = captureSignedEvent();
    expect(signed.tags).toContainEqual(["d2a", TAG_D2A_DELIVER]);
    const parsed = parseD2AMessage(signed.content, recipientSk, senderPk);
    expect(parsed?.type).toBe("deliver");
    expect((parsed as { payload: D2ADeliverPayload }).payload).toEqual(payload);
  });

  it("relay operators see only the encrypted ciphertext, not the plaintext", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok")]);
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    const recipientPk = getPublicKey(generateSecretKey());
    await deliverContent(
      senderSk,
      senderPk,
      recipientPk,
      {
        text: "SECRETSCAN-MARKER",
        author: "Anon",
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
        verdict: "quality",
        topics: ["t"],
      },
      [RELAYS[0]],
    );
    const signed = captureSignedEvent();
    expect(signed.content).not.toContain("SECRETSCAN-MARKER");
    expect(signed.content).not.toContain("Anon");
    // The d2a routing tag IS public — that's documented in the spec.
    expect(signed.tags).toContainEqual(["d2a", TAG_D2A_DELIVER]);
  });
});

describe("sendComment", () => {
  it("encrypts a comment payload referencing a content hash + title", async () => {
    mockPublish.mockReturnValue([Promise.resolve("ok")]);
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);

    const payload: D2ACommentPayload = {
      contentHash: "deadbeef",
      contentTitle: "Title",
      comment: "great article",
      timestamp: 1700000000000,
    };
    await sendComment(senderSk, senderPk, recipientPk, payload, [RELAYS[0]]);

    const signed = captureSignedEvent();
    expect(signed.tags).toContainEqual(["d2a", TAG_D2A_COMMENT]);
    const decrypted = decryptMessage(signed.content, recipientSk, senderPk);
    expect(JSON.parse(decrypted).payload).toEqual(payload);
  });
});
