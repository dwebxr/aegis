import { parseD2AMessage, isHandshakeExpired } from "@/lib/agent/handshake";
import { encryptMessage } from "@/lib/nostr/encrypt";
import { getPublicKey } from "nostr-tools/pure";
import { HANDSHAKE_TIMEOUT_MS } from "@/lib/agent/protocol";
import type { HandshakeState, D2AMessage } from "@/lib/agent/types";

describe("parseD2AMessage — edge cases", () => {
  // Generate real keypairs for testing
  const sk1 = new Uint8Array(32).fill(1);
  sk1[0] = 0x01; // Ensure valid key
  const pk1 = getPublicKey(sk1);

  const sk2 = new Uint8Array(32).fill(2);
  sk2[0] = 0x02;
  const pk2 = getPublicKey(sk2);

  it("returns null for empty string", () => {
    expect(parseD2AMessage("", sk2, pk1)).toBeNull();
  });

  it("returns null for random garbage", () => {
    expect(parseD2AMessage("not-encrypted-at-all", sk2, pk1)).toBeNull();
  });

  it("returns null for valid JSON that is not encrypted", () => {
    expect(parseD2AMessage('{"type":"offer"}', sk2, pk1)).toBeNull();
  });

  it("roundtrips an offer message through real encryption", () => {
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: pk1,
      toPubkey: pk2,
      payload: { topic: "ai", score: 8.5, contentPreview: "Test content preview" },
    };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    const parsed = parseD2AMessage(encrypted, sk2, pk1);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("offer");
    expect(parsed!.fromPubkey).toBe(pk1);
    expect(parsed!.toPubkey).toBe(pk2);
    expect((parsed!.payload as { topic: string }).topic).toBe("ai");
  });

  it("roundtrips a deliver message with VCL scores", () => {
    const msg: D2AMessage = {
      type: "deliver",
      fromPubkey: pk1,
      toPubkey: pk2,
      payload: {
        text: "Full article text here",
        author: "Dr. Smith",
        scores: { originality: 8, insight: 9, credibility: 7, composite: 8.2 },
        verdict: "quality",
        topics: ["ai", "ml"],
        vSignal: 8,
        cContext: 7,
        lSlop: 2,
      },
    };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    const parsed = parseD2AMessage(encrypted, sk2, pk1);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("deliver");
    const payload = parsed!.payload as { vSignal: number; cContext: number; lSlop: number };
    expect(payload.vSignal).toBe(8);
    expect(payload.cContext).toBe(7);
    expect(payload.lSlop).toBe(2);
  });

  it("handles unicode in message content", () => {
    const msg: D2AMessage = {
      type: "deliver",
      fromPubkey: pk1,
      toPubkey: pk2,
      payload: {
        text: "日本語のコンテンツ 🤖 émojis",
        author: "著者",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 },
        verdict: "quality",
        topics: ["テスト"],
      },
    };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    const parsed = parseD2AMessage(encrypted, sk2, pk1);

    expect(parsed).not.toBeNull();
    const payload = parsed!.payload as { text: string; author: string; topics: string[] };
    expect(payload.text).toContain("日本語");
    expect(payload.author).toBe("著者");
    expect(payload.topics).toContain("テスト");
  });

  it("returns null for encrypted valid JSON missing required D2A fields", () => {
    // Peer sends valid JSON that decrypts but isn't a proper D2AMessage
    const badMsg = { type: "offer", fromPubkey: pk1 }; // missing toPubkey, payload
    const encrypted = encryptMessage(JSON.stringify(badMsg), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("returns null for encrypted JSON with invalid type", () => {
    const badMsg = { type: "unknown", fromPubkey: pk1, toPubkey: pk2, payload: {} };
    const encrypted = encryptMessage(JSON.stringify(badMsg), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("returns null for encrypted array instead of object", () => {
    const encrypted = encryptMessage("[1,2,3]", sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("returns null for encrypted null", () => {
    const encrypted = encryptMessage("null", sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("returns null when decrypting with wrong key", () => {
    const wrongSk = new Uint8Array(32).fill(99);
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: pk1,
      toPubkey: pk2,
      payload: { topic: "ai", score: 5, contentPreview: "test" },
    };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    // Try to decrypt with wrong key — should fail gracefully
    const parsed = parseD2AMessage(encrypted, wrongSk, pk1);
    expect(parsed).toBeNull();
  });
});

describe("isHandshakeExpired — boundary conditions", () => {
  function makeHandshake(ageMs: number): HandshakeState {
    return {
      peerId: "test-peer",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 7.0,
      startedAt: Date.now() - ageMs,
    };
  }

  it("fresh handshake (0ms) is not expired", () => {
    expect(isHandshakeExpired(makeHandshake(0))).toBe(false);
  });

  it("handshake at exactly timeout is expired", () => {
    // At exactly HANDSHAKE_TIMEOUT_MS, Date.now() - startedAt > HANDSHAKE_TIMEOUT_MS
    // depends on timing — use slightly over
    expect(isHandshakeExpired(makeHandshake(HANDSHAKE_TIMEOUT_MS + 1))).toBe(true);
  });

  it("handshake 1ms before timeout is not expired", () => {
    expect(isHandshakeExpired(makeHandshake(HANDSHAKE_TIMEOUT_MS - 100))).toBe(false);
  });

  it("very old handshake (1 hour) is expired", () => {
    expect(isHandshakeExpired(makeHandshake(3600_000))).toBe(true);
  });

  it("future handshake (negative age) is not expired", () => {
    // startedAt is in the future → diff is negative → not expired
    expect(isHandshakeExpired(makeHandshake(-10_000))).toBe(false);
  });

  it("expired check works for all phases", () => {
    const phases = ["offered", "accepted", "delivering", "completed", "rejected"] as const;
    for (const phase of phases) {
      const hs: HandshakeState = {
        peerId: "p",
        phase,
        offeredTopic: "t",
        offeredScore: 5,
        startedAt: Date.now() - HANDSHAKE_TIMEOUT_MS - 1000,
      };
      expect(isHandshakeExpired(hs)).toBe(true);
    }
  });
});

describe("parseD2AMessage — value bounds validation", () => {
  const sk1 = new Uint8Array(32).fill(1);
  const pk1 = getPublicKey(sk1);
  const sk2 = new Uint8Array(32).fill(2);
  const pk2 = getPublicKey(sk2);

  function encrypt(msg: unknown) {
    return encryptMessage(JSON.stringify(msg), sk1, pk2);
  }

  it("rejects offer with NaN score", () => {
    const msg = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: NaN, contentPreview: "x" } };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("rejects offer with Infinity score", () => {
    const msg = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: Infinity, contentPreview: "x" } };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("rejects offer with score > 10", () => {
    const msg = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: 11, contentPreview: "x" } };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("rejects offer with negative score", () => {
    const msg = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: -1, contentPreview: "x" } };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("rejects offer with empty topic", () => {
    const msg = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "", score: 5, contentPreview: "x" } };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("rejects offer with oversized contentPreview", () => {
    const msg = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: 5, contentPreview: "x".repeat(600) } };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("rejects deliver with oversized text", () => {
    const msg = { type: "deliver", fromPubkey: pk1, toPubkey: pk2, payload: { text: "x".repeat(6000), author: "A", verdict: "quality", topics: ["ai"] } };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("rejects deliver with too many topics", () => {
    const topics = Array.from({ length: 25 }, (_, i) => `topic-${i}`);
    const msg = { type: "deliver", fromPubkey: pk1, toPubkey: pk2, payload: { text: "ok", author: "A", verdict: "quality", topics } };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("accepts offer with score at boundary (0 and 10)", () => {
    const msg0 = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: 0, contentPreview: "x" } };
    expect(parseD2AMessage(encrypt(msg0), sk2, pk1)).not.toBeNull();
    const msg10 = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: 10, contentPreview: "x" } };
    expect(parseD2AMessage(encrypt(msg10), sk2, pk1)).not.toBeNull();
  });
});

describe("parseD2AMessage — payload validation", () => {
  const sk1 = new Uint8Array(32).fill(1);
  const pk1 = getPublicKey(sk1);
  const sk2 = new Uint8Array(32).fill(2);
  const pk2 = getPublicKey(sk2);

  it("rejects offer with missing topic field", () => {
    const bad = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { score: 5, contentPreview: "x" } };
    const encrypted = encryptMessage(JSON.stringify(bad), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("rejects offer with missing score field", () => {
    const bad = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", contentPreview: "x" } };
    const encrypted = encryptMessage(JSON.stringify(bad), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("rejects offer with wrong score type", () => {
    const bad = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: "high", contentPreview: "x" } };
    const encrypted = encryptMessage(JSON.stringify(bad), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("rejects deliver with missing text field", () => {
    const bad = { type: "deliver", fromPubkey: pk1, toPubkey: pk2, payload: { author: "A", verdict: "quality", topics: ["ai"] } };
    const encrypted = encryptMessage(JSON.stringify(bad), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("rejects deliver with missing topics array", () => {
    const bad = { type: "deliver", fromPubkey: pk1, toPubkey: pk2, payload: { text: "t", author: "A", verdict: "quality" } };
    const encrypted = encryptMessage(JSON.stringify(bad), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("rejects deliver with topics as string instead of array", () => {
    const bad = { type: "deliver", fromPubkey: pk1, toPubkey: pk2, payload: { text: "t", author: "A", verdict: "quality", topics: "ai" } };
    const encrypted = encryptMessage(JSON.stringify(bad), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("accepts valid offer payload", () => {
    const msg: D2AMessage = { type: "offer", fromPubkey: pk1, toPubkey: pk2, payload: { topic: "ai", score: 8, contentPreview: "test" } };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    const parsed = parseD2AMessage(encrypted, sk2, pk1);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("offer");
    expect(parsed!.payload).toEqual({ topic: "ai", score: 8, contentPreview: "test" });
  });

  it("accepts valid deliver payload", () => {
    const msg: D2AMessage = {
      type: "deliver", fromPubkey: pk1, toPubkey: pk2,
      payload: { text: "content", author: "Author", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 }, verdict: "quality", topics: ["ai"] },
    };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    const parsed = parseD2AMessage(encrypted, sk2, pk1);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("deliver");
  });

  it("accept/reject ignore payload content and return empty object", () => {
    const msg = { type: "accept", fromPubkey: pk1, toPubkey: pk2, payload: { extra: "data" } };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    const parsed = parseD2AMessage(encrypted, sk2, pk1);
    expect(parsed).not.toBeNull();
    expect(parsed!.payload).toEqual({});
  });
});
