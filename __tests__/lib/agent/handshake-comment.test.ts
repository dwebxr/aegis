import { parseD2AMessage } from "@/lib/agent/handshake";
import { TAG_D2A_COMMENT, MAX_COMMENT_LENGTH } from "@/lib/agent/protocol";

// Mock NIP-44 encrypt/decrypt
jest.mock("@/lib/nostr/encrypt", () => ({
  encryptMessage: (plaintext: string) => plaintext,
  decryptMessage: (ciphertext: string) => ciphertext,
}));

jest.mock("@/lib/nostr/publish", () => ({
  publishAndPartition: jest.fn().mockResolvedValue({ published: ["wss://relay.test"], failed: [] }),
}));

jest.mock("nostr-tools/pure", () => ({
  finalizeEvent: jest.fn().mockReturnValue({ id: "test-id", sig: "test-sig", pubkey: "test-pk", kind: 21078, tags: [], content: "", created_at: 0 }),
}));

const SENDER_PK = "aabbccdd11223344556677889900aabbccdd11223344556677889900aabbccdd";
const RECIPIENT_SK = new Uint8Array(32);

describe("parseD2AMessage — comment type", () => {
  it("parses valid comment message", () => {
    const msg = JSON.stringify({
      type: "comment",
      fromPubkey: SENDER_PK,
      toPubkey: "recipient",
      payload: {
        contentHash: "abc123",
        contentTitle: "Test Article",
        comment: "Great insight!",
        timestamp: 1700000000,
      },
    });
    const result = parseD2AMessage(msg, RECIPIENT_SK, SENDER_PK);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("comment");
    if (result!.type === "comment") {
      expect(result!.payload.comment).toBe("Great insight!");
      expect(result!.payload.contentHash).toBe("abc123");
    }
  });

  it("rejects comment exceeding MAX_COMMENT_LENGTH", () => {
    const msg = JSON.stringify({
      type: "comment",
      fromPubkey: SENDER_PK,
      toPubkey: "recipient",
      payload: {
        contentHash: "abc123",
        contentTitle: "Test",
        comment: "x".repeat(MAX_COMMENT_LENGTH + 1),
        timestamp: 1700000000,
      },
    });
    const result = parseD2AMessage(msg, RECIPIENT_SK, SENDER_PK);
    expect(result).toBeNull();
  });

  it("accepts comment at exactly MAX_COMMENT_LENGTH", () => {
    const msg = JSON.stringify({
      type: "comment",
      fromPubkey: SENDER_PK,
      toPubkey: "recipient",
      payload: {
        contentHash: "abc123",
        contentTitle: "Test",
        comment: "x".repeat(MAX_COMMENT_LENGTH),
        timestamp: 1700000000,
      },
    });
    const result = parseD2AMessage(msg, RECIPIENT_SK, SENDER_PK);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("comment");
  });

  it("rejects comment with missing contentHash", () => {
    const msg = JSON.stringify({
      type: "comment",
      fromPubkey: SENDER_PK,
      toPubkey: "recipient",
      payload: {
        contentTitle: "Test",
        comment: "Hello",
        timestamp: 1700000000,
      },
    });
    const result = parseD2AMessage(msg, RECIPIENT_SK, SENDER_PK);
    expect(result).toBeNull();
  });

  it("rejects comment with missing comment text", () => {
    const msg = JSON.stringify({
      type: "comment",
      fromPubkey: SENDER_PK,
      toPubkey: "recipient",
      payload: {
        contentHash: "abc123",
        contentTitle: "Test",
        timestamp: 1700000000,
      },
    });
    const result = parseD2AMessage(msg, RECIPIENT_SK, SENDER_PK);
    expect(result).toBeNull();
  });

  it("rejects comment with missing timestamp", () => {
    const msg = JSON.stringify({
      type: "comment",
      fromPubkey: SENDER_PK,
      toPubkey: "recipient",
      payload: {
        contentHash: "abc123",
        contentTitle: "Test",
        comment: "Hello",
      },
    });
    const result = parseD2AMessage(msg, RECIPIENT_SK, SENDER_PK);
    expect(result).toBeNull();
  });

  it("still parses other message types correctly", () => {
    const msg = JSON.stringify({
      type: "offer",
      fromPubkey: SENDER_PK,
      toPubkey: "recipient",
      payload: {
        topic: "bitcoin",
        score: 8.5,
        contentPreview: "Bitcoin reaches new ATH...",
      },
    });
    const result = parseD2AMessage(msg, RECIPIENT_SK, SENDER_PK);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("offer");
  });
});

describe("D2A protocol constants", () => {
  it("TAG_D2A_COMMENT is defined", () => {
    expect(TAG_D2A_COMMENT).toBe("aegis-d2a-comment");
  });

  it("MAX_COMMENT_LENGTH is 280", () => {
    expect(MAX_COMMENT_LENGTH).toBe(280);
  });
});
