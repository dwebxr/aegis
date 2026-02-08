import { isHandshakeExpired, parseD2AMessage } from "@/lib/agent/handshake";
import { encryptMessage } from "@/lib/nostr/encrypt";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { HANDSHAKE_TIMEOUT_MS } from "@/lib/agent/protocol";
import type { HandshakeState, D2AMessage } from "@/lib/agent/types";

describe("isHandshakeExpired", () => {
  function makeHandshake(startedAt: number): HandshakeState {
    return {
      peerId: "peer123",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 8.0,
      startedAt,
    };
  }

  it("returns false for fresh handshake", () => {
    const hs = makeHandshake(Date.now());
    expect(isHandshakeExpired(hs)).toBe(false);
  });

  it("returns false for handshake within timeout", () => {
    const hs = makeHandshake(Date.now() - (HANDSHAKE_TIMEOUT_MS - 1000));
    expect(isHandshakeExpired(hs)).toBe(false);
  });

  it("returns true for handshake past timeout", () => {
    const hs = makeHandshake(Date.now() - HANDSHAKE_TIMEOUT_MS - 1);
    expect(isHandshakeExpired(hs)).toBe(true);
  });

  it("returns true for very old handshake", () => {
    const hs = makeHandshake(Date.now() - 60 * 60 * 1000); // 1 hour ago
    expect(isHandshakeExpired(hs)).toBe(true);
  });

  it("uses HANDSHAKE_TIMEOUT_MS (30 seconds)", () => {
    expect(HANDSHAKE_TIMEOUT_MS).toBe(30_000);
    const justExpired = makeHandshake(Date.now() - 30_001);
    expect(isHandshakeExpired(justExpired)).toBe(true);
    const notYet = makeHandshake(Date.now() - 29_999);
    expect(isHandshakeExpired(notYet)).toBe(false);
  });
});

describe("parseD2AMessage — integration with encrypt/decrypt", () => {
  const alice = deriveNostrKeypairFromText("alice-handshake-test");
  const bob = deriveNostrKeypairFromText("bob-handshake-test");

  it("parses an encrypted offer message", () => {
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: alice.pk,
      toPubkey: bob.pk,
      payload: {
        topic: "machine-learning",
        score: 8.5,
        contentPreview: "New research on transformer architectures...",
      },
    };

    const encrypted = encryptMessage(JSON.stringify(msg), alice.sk, bob.pk);
    const parsed = parseD2AMessage(encrypted, bob.sk, alice.pk);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("offer");
    expect(parsed!.fromPubkey).toBe(alice.pk);
    expect(parsed!.toPubkey).toBe(bob.pk);
    expect((parsed!.payload as { topic: string }).topic).toBe("machine-learning");
    expect((parsed!.payload as { score: number }).score).toBe(8.5);
  });

  it("parses an encrypted accept message", () => {
    const msg: D2AMessage = {
      type: "accept",
      fromPubkey: bob.pk,
      toPubkey: alice.pk,
      payload: {},
    };

    const encrypted = encryptMessage(JSON.stringify(msg), bob.sk, alice.pk);
    const parsed = parseD2AMessage(encrypted, alice.sk, bob.pk);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("accept");
  });

  it("parses an encrypted deliver message with full content", () => {
    const msg: D2AMessage = {
      type: "deliver",
      fromPubkey: alice.pk,
      toPubkey: bob.pk,
      payload: {
        text: "Full article about transformers and attention mechanisms...",
        author: "Dr. Smith",
        scores: { originality: 8, insight: 9, credibility: 7, composite: 8.2 },
        verdict: "quality",
        topics: ["transformers", "attention"],
        vSignal: 9,
        cContext: 7,
        lSlop: 2,
      },
    };

    const encrypted = encryptMessage(JSON.stringify(msg), alice.sk, bob.pk);
    const parsed = parseD2AMessage(encrypted, bob.sk, alice.pk);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("deliver");
    const payload = parsed!.payload as { text: string; author: string; topics: string[] };
    expect(payload.text).toContain("transformers");
    expect(payload.author).toBe("Dr. Smith");
    expect(payload.topics).toContain("attention");
  });

  it("parses a reject message", () => {
    const msg: D2AMessage = {
      type: "reject",
      fromPubkey: bob.pk,
      toPubkey: alice.pk,
      payload: {},
    };

    const encrypted = encryptMessage(JSON.stringify(msg), bob.sk, alice.pk);
    const parsed = parseD2AMessage(encrypted, alice.sk, bob.pk);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("reject");
  });

  it("throws on decryption with wrong key", () => {
    const charlie = deriveNostrKeypairFromText("charlie-handshake-test");
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: alice.pk,
      toPubkey: bob.pk,
      payload: { topic: "secret", score: 9, contentPreview: "..." },
    };

    const encrypted = encryptMessage(JSON.stringify(msg), alice.sk, bob.pk);
    // Charlie cannot decrypt Alice→Bob message — returns null instead of throwing
    expect(parseD2AMessage(encrypted, charlie.sk, alice.pk)).toBeNull();
  });
});
