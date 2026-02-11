import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { encryptMessage, decryptMessage } from "@/lib/nostr/encrypt";
import { parseD2AMessage } from "@/lib/agent/handshake";
import { calculateResonance, broadcastPresence } from "@/lib/agent/discovery";
import { createEmptyProfile } from "@/lib/preferences/types";
import { learn } from "@/lib/preferences/engine";
import type { D2AMessage, AgentProfile } from "@/lib/agent/types";

const alice = deriveNostrKeypairFromText("integration-alice");
const bob = deriveNostrKeypairFromText("integration-bob");

describe("D2A full message cycle — real crypto", () => {
  it("offer → accept → deliver roundtrip", () => {
    // Step 1: Alice sends offer to Bob
    const offer: D2AMessage = {
      type: "offer",
      fromPubkey: alice.pk,
      toPubkey: bob.pk,
      payload: { topic: "machine-learning", score: 8.5, contentPreview: "New research on attention..." },
    };

    const encryptedOffer = encryptMessage(JSON.stringify(offer), alice.sk, bob.pk);
    expect(typeof encryptedOffer).toBe("string");
    expect(encryptedOffer).not.toContain("machine-learning"); // Content should be encrypted

    // Step 2: Bob decrypts and parses the offer
    const parsedOffer = parseD2AMessage(encryptedOffer, bob.sk, alice.pk);
    expect(parsedOffer).not.toBeNull();
    expect(parsedOffer!.type).toBe("offer");
    expect((parsedOffer!.payload as { topic: string }).topic).toBe("machine-learning");

    // Step 3: Bob sends accept
    const accept: D2AMessage = {
      type: "accept",
      fromPubkey: bob.pk,
      toPubkey: alice.pk,
      payload: {},
    };
    const encryptedAccept = encryptMessage(JSON.stringify(accept), bob.sk, alice.pk);
    const parsedAccept = parseD2AMessage(encryptedAccept, alice.sk, bob.pk);
    expect(parsedAccept!.type).toBe("accept");

    // Step 4: Alice delivers content
    const deliver: D2AMessage = {
      type: "deliver",
      fromPubkey: alice.pk,
      toPubkey: bob.pk,
      payload: {
        text: "Full article about attention mechanisms in transformers...",
        author: "Dr. Research",
        scores: { originality: 8, insight: 9, credibility: 7, composite: 8.2 },
        verdict: "quality",
        topics: ["machine-learning", "attention"],
        vSignal: 9,
        cContext: 8,
        lSlop: 1,
      },
    };
    const encryptedDeliver = encryptMessage(JSON.stringify(deliver), alice.sk, bob.pk);
    const parsedDeliver = parseD2AMessage(encryptedDeliver, bob.sk, alice.pk);
    expect(parsedDeliver!.type).toBe("deliver");

    const content = parsedDeliver!.payload as { text: string; scores: { composite: number }; topics: string[] };
    expect(content.text).toContain("attention mechanisms");
    expect(content.scores.composite).toBe(8.2);
    expect(content.topics).toContain("machine-learning");
  });

  it("third party cannot eavesdrop on encrypted messages", () => {
    const charlie = deriveNostrKeypairFromText("integration-charlie");

    const msg: D2AMessage = {
      type: "deliver",
      fromPubkey: alice.pk,
      toPubkey: bob.pk,
      payload: { text: "Secret content", author: "a", scores: { originality: 5, insight: 5, credibility: 5, composite: 5 }, verdict: "quality", topics: [] },
    };

    const encrypted = encryptMessage(JSON.stringify(msg), alice.sk, bob.pk);

    // Charlie tries to decrypt — should fail
    expect(parseD2AMessage(encrypted, charlie.sk, alice.pk)).toBeNull();
    expect(parseD2AMessage(encrypted, charlie.sk, bob.pk)).toBeNull();

    // Bob can decrypt
    expect(parseD2AMessage(encrypted, bob.sk, alice.pk)).not.toBeNull();
  });

  it("reject message roundtrips correctly", () => {
    const reject: D2AMessage = {
      type: "reject",
      fromPubkey: bob.pk,
      toPubkey: alice.pk,
      payload: {},
    };
    const encrypted = encryptMessage(JSON.stringify(reject), bob.sk, alice.pk);
    const parsed = parseD2AMessage(encrypted, alice.sk, bob.pk);
    expect(parsed!.type).toBe("reject");
    expect(parsed!.payload).toEqual({});
  });
});

describe("D2A resonance calculation — preference-driven matching", () => {
  it("calculates higher resonance for peers with shared interests", () => {
    let profile = createEmptyProfile("test");

    // Build affinity for "ai" and "crypto"
    for (let i = 0; i < 5; i++) {
      profile = learn(profile, { action: "validate", topics: ["ai", "crypto"], author: "a", composite: 8, verdict: "quality" });
    }

    const compatiblePeer: AgentProfile = {
      nostrPubkey: "peer1",
      interests: ["ai", "crypto", "web3"],
      capacitySlots: 5,
      lastSeen: Date.now(),
    };

    const incompatiblePeer: AgentProfile = {
      nostrPubkey: "peer2",
      interests: ["cooking", "gardening", "sports"],
      capacitySlots: 5,
      lastSeen: Date.now(),
    };

    const compatibleScore = calculateResonance(profile, compatiblePeer);
    const incompatibleScore = calculateResonance(profile, incompatiblePeer);

    expect(compatibleScore).toBeGreaterThan(incompatibleScore);
  });

  it("returns 0 resonance for peer with empty interests", () => {
    const profile = createEmptyProfile("test");
    const peer: AgentProfile = {
      nostrPubkey: "peer3",
      interests: [],
      capacitySlots: 5,
      lastSeen: Date.now(),
    };

    expect(calculateResonance(profile, peer)).toBe(0);
  });

  it("handles profile with no topic affinities", () => {
    const profile = createEmptyProfile("test");
    const peer: AgentProfile = {
      nostrPubkey: "peer4",
      interests: ["ai"],
      capacitySlots: 5,
      lastSeen: Date.now(),
    };

    // Should not throw, returns some resonance value
    const score = calculateResonance(profile, peer);
    expect(typeof score).toBe("number");
    expect(isNaN(score)).toBe(false);
  });
});

describe("Keypair derivation — determinism and uniqueness", () => {
  it("same seed produces same keypair", () => {
    const a = deriveNostrKeypairFromText("deterministic-seed");
    const b = deriveNostrKeypairFromText("deterministic-seed");
    expect(a.pk).toBe(b.pk);
    expect(Array.from(a.sk)).toEqual(Array.from(b.sk));
  });

  it("different seeds produce different keypairs", () => {
    const a = deriveNostrKeypairFromText("seed-a");
    const b = deriveNostrKeypairFromText("seed-b");
    expect(a.pk).not.toBe(b.pk);
  });

  it("derived key is valid for encryption/decryption", () => {
    const keys = deriveNostrKeypairFromText("encryption-test-seed");
    const otherKeys = deriveNostrKeypairFromText("other-seed");

    const plaintext = "Hello, encrypted world!";
    const encrypted = encryptMessage(plaintext, keys.sk, otherKeys.pk);
    const decrypted = decryptMessage(encrypted, otherKeys.sk, keys.pk);
    expect(decrypted).toBe(plaintext);
  });

  it("handles unicode in seed text", () => {
    const keys = deriveNostrKeypairFromText("日本語シード🔑");
    expect(keys.pk).toHaveLength(64);
    expect(keys.sk).toHaveLength(32);
  });

  it("handles very long seed text", () => {
    const keys = deriveNostrKeypairFromText("a".repeat(10000));
    expect(keys.pk).toHaveLength(64);
  });

  it("handles empty string seed", () => {
    const keys = deriveNostrKeypairFromText("");
    expect(keys.pk).toHaveLength(64);
    expect(keys.sk).toHaveLength(32);
  });
});
