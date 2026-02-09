/**
 * Edge case tests for handshake module — real crypto operations.
 */
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
    const phases = ["idle", "offered", "accepted", "delivering", "completed", "rejected"] as const;
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
