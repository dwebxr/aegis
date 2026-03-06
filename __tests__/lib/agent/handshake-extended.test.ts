/**
 * Extended tests for handshake.ts — parseD2AMessage edge cases and validation.
 */

jest.mock("nostr-tools/pure", () => ({
  finalizeEvent: jest.fn((_template: unknown, _sk: unknown) => ({
    kind: 20004,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: "encrypted",
    pubkey: "sender-pk",
    id: "event-id",
    sig: "sig",
  })),
}));

jest.mock("@/lib/nostr/encrypt", () => ({
  encryptMessage: jest.fn(() => "encrypted-content"),
  decryptMessage: jest.fn(),
}));

jest.mock("@/lib/nostr/publish", () => ({
  publishAndPartition: jest.fn(),
}));

import { parseD2AMessage, isHandshakeExpired, sendOffer, sendAccept, sendReject, deliverContent, sendComment } from "@/lib/agent/handshake";
import { decryptMessage } from "@/lib/nostr/encrypt";
import { publishAndPartition } from "@/lib/nostr/publish";
import { HANDSHAKE_TIMEOUT_MS } from "@/lib/agent/protocol";

const sk = new Uint8Array(32);
const senderPk = "sender-pubkey-hex";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("parseD2AMessage", () => {
  it("parses valid offer message", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "offer",
      fromPubkey: "from",
      toPubkey: "to",
      payload: { topic: "ai", score: 8.5, contentPreview: "Preview text" },
    }));

    const result = parseD2AMessage("encrypted", sk, senderPk);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("offer");
    expect(result!.payload).toEqual({ topic: "ai", score: 8.5, contentPreview: "Preview text" });
  });

  it("parses valid accept message", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "accept",
      fromPubkey: "from",
      toPubkey: "to",
      payload: {},
    }));

    const result = parseD2AMessage("encrypted", sk, senderPk);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("accept");
    expect(result!.payload).toEqual({});
  });

  it("parses valid reject message", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "reject",
      fromPubkey: "from",
      toPubkey: "to",
      payload: {},
    }));

    const result = parseD2AMessage("encrypted", sk, senderPk);
    expect(result!.type).toBe("reject");
  });

  it("parses valid deliver message", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "deliver",
      fromPubkey: "from",
      toPubkey: "to",
      payload: {
        text: "Content text",
        author: "Author",
        verdict: "quality",
        topics: ["ai"],
      },
    }));

    const result = parseD2AMessage("encrypted", sk, senderPk);
    expect(result!.type).toBe("deliver");
  });

  it("parses valid comment message", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "comment",
      fromPubkey: "from",
      toPubkey: "to",
      payload: {
        contentHash: "abc123",
        contentTitle: "Title",
        comment: "Great content!",
        timestamp: Date.now(),
      },
    }));

    const result = parseD2AMessage("encrypted", sk, senderPk);
    expect(result!.type).toBe("comment");
  });

  it("returns null for invalid offer payload (missing fields)", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "offer",
      fromPubkey: "from",
      toPubkey: "to",
      payload: { topic: "ai" }, // missing score and contentPreview
    }));

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null for invalid deliver payload (bad verdict)", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "deliver",
      fromPubkey: "from",
      toPubkey: "to",
      payload: {
        text: "Content",
        author: "Auth",
        verdict: "unknown", // not "quality" or "slop"
        topics: [],
      },
    }));

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null for invalid comment payload (comment too long)", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "comment",
      fromPubkey: "from",
      toPubkey: "to",
      payload: {
        contentHash: "abc",
        contentTitle: "Title",
        comment: "x".repeat(10000), // exceeds MAX_COMMENT_LENGTH
        timestamp: Date.now(),
      },
    }));

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null for unknown message type", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "unknown-type",
      fromPubkey: "from",
      toPubkey: "to",
      payload: {},
    }));

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null for missing fromPubkey", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "accept",
      toPubkey: "to",
      payload: {},
    }));

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null for missing payload key", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce(JSON.stringify({
      type: "accept",
      fromPubkey: "from",
      toPubkey: "to",
    }));

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce("{not json");

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null when decryption fails", () => {
    (decryptMessage as jest.Mock).mockImplementationOnce(() => {
      throw new Error("Decryption failed");
    });

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null for non-object parsed result", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce('"just a string"');

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });

  it("returns null for null parsed result", () => {
    (decryptMessage as jest.Mock).mockReturnValueOnce("null");

    expect(parseD2AMessage("encrypted", sk, senderPk)).toBeNull();
  });
});

describe("isHandshakeExpired", () => {
  it("returns false for fresh handshake", () => {
    expect(isHandshakeExpired({
      peerId: "peer",
      phase: "offered",
      offeredTopic: "test",
      offeredScore: 5,
      startedAt: Date.now(),
    })).toBe(false);
  });

  it("returns true for expired handshake", () => {
    expect(isHandshakeExpired({
      peerId: "peer",
      phase: "offered",
      offeredTopic: "test",
      offeredScore: 5,
      startedAt: Date.now() - HANDSHAKE_TIMEOUT_MS - 1000,
    })).toBe(true);
  });

  it("returns false at exact timeout boundary", () => {
    // At exactly the timeout, Date.now() - startedAt === HANDSHAKE_TIMEOUT_MS, which is NOT > so returns false
    const startedAt = Date.now() - HANDSHAKE_TIMEOUT_MS;
    expect(isHandshakeExpired({ peerId: "peer", phase: "offered", offeredTopic: "test", offeredScore: 5, startedAt })).toBe(false);
  });
});

describe("sendOffer", () => {
  it("sends offer and returns handshake state", async () => {
    (publishAndPartition as jest.Mock).mockResolvedValueOnce({
      published: ["wss://relay1.example.com"],
      failed: [],
    });

    const result = await sendOffer(
      sk,
      "my-pk",
      "peer-pk",
      { topic: "ai", score: 8, contentPreview: "Preview" },
      ["wss://relay1.example.com"],
    );

    expect(result.peerId).toBe("peer-pk");
    expect(result.phase).toBe("offered");
    expect(result.offeredTopic).toBe("ai");
    expect(result.offeredScore).toBe(8);
    expect(result.startedAt).toBeGreaterThan(0);
  });

  it("throws when all relays fail", async () => {
    (publishAndPartition as jest.Mock).mockResolvedValueOnce({
      published: [],
      failed: ["wss://relay1.example.com"],
    });

    await expect(sendOffer(
      sk, "my-pk", "peer-pk",
      { topic: "ai", score: 8, contentPreview: "Preview" },
      ["wss://relay1.example.com"],
    )).rejects.toThrow("failed on all");
  });
});

describe("sendAccept / sendReject / deliverContent / sendComment", () => {
  beforeEach(() => {
    (publishAndPartition as jest.Mock).mockResolvedValue({
      published: ["wss://relay1.example.com"],
      failed: [],
    });
  });

  it("sendAccept returns publish result", async () => {
    const result = await sendAccept(sk, "my-pk", "peer-pk", ["wss://relay1.example.com"]);
    expect(result.published).toHaveLength(1);
  });

  it("sendReject returns publish result", async () => {
    const result = await sendReject(sk, "my-pk", "peer-pk", ["wss://relay1.example.com"]);
    expect(result.published).toHaveLength(1);
  });

  it("deliverContent returns publish result", async () => {
    const result = await deliverContent(
      sk, "my-pk", "peer-pk",
      { text: "Content", author: "Auth", scores: { originality: 7, insight: 6, credibility: 8, composite: 7 }, verdict: "quality" as const, topics: ["ai"] },
      ["wss://relay1.example.com"],
    );
    expect(result.published).toHaveLength(1);
  });

  it("sendComment returns publish result", async () => {
    const result = await sendComment(
      sk, "my-pk", "peer-pk",
      { contentHash: "abc", contentTitle: "Title", comment: "Nice!", timestamp: Date.now() },
      ["wss://relay1.example.com"],
    );
    expect(result.published).toHaveLength(1);
  });
});
