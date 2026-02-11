import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import type { D2AOfferPayload, D2ADeliverPayload, HandshakeState } from "@/lib/agent/types";

// Mock publishAndPartition to simulate relay behavior
const mockPublishAndPartition = jest.fn();
jest.mock("@/lib/nostr/publish", () => ({
  publishAndPartition: (...args: unknown[]) => mockPublishAndPartition(...args),
}));

import { sendOffer, sendAccept, sendReject, deliverContent } from "@/lib/agent/handshake";

const alice = deriveNostrKeypairFromText("alice-send-test");
const bob = deriveNostrKeypairFromText("bob-send-test");
const relays = ["wss://relay1.example.com", "wss://relay2.example.com"];

describe("sendOffer", () => {
  beforeEach(() => {
    mockPublishAndPartition.mockReset();
  });

  it("returns a HandshakeState with phase='offered'", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: relays, failed: [] });

    const offer: D2AOfferPayload = { topic: "ai", score: 8.5, contentPreview: "Test preview" };
    const result: HandshakeState = await sendOffer(alice.sk, alice.pk, bob.pk, offer, relays);

    expect(result.peerId).toBe(bob.pk);
    expect(result.phase).toBe("offered");
    expect(result.offeredTopic).toBe("ai");
    expect(result.offeredScore).toBe(8.5);
    expect(result.startedAt).toBeLessThanOrEqual(Date.now());
    expect(result.startedAt).toBeGreaterThan(Date.now() - 5000);
  });

  it("calls publishAndPartition with a signed event", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: relays, failed: [] });

    await sendOffer(alice.sk, alice.pk, bob.pk, { topic: "ml", score: 7, contentPreview: "..." }, relays);

    expect(mockPublishAndPartition).toHaveBeenCalledTimes(1);
    const [signedEvent, usedRelays] = mockPublishAndPartition.mock.calls[0];
    expect(usedRelays).toEqual(relays);
    expect(signedEvent).toHaveProperty("id");
    expect(signedEvent).toHaveProperty("sig");
    expect(signedEvent).toHaveProperty("content");
    // Content should be encrypted (not plain JSON)
    expect(() => JSON.parse(signedEvent.content)).toThrow();
    // Tags should include "p" and "d2a"
    expect(signedEvent.tags).toContainEqual(["p", bob.pk]);
    expect(signedEvent.tags.find((t: string[]) => t[0] === "d2a")).toBeTruthy();
  });

  it("throws when all relays fail", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: [], failed: relays });

    await expect(
      sendOffer(alice.sk, alice.pk, bob.pk, { topic: "ai", score: 8, contentPreview: "..." }, relays),
    ).rejects.toThrow(/failed on all/);
  });
});

describe("sendAccept", () => {
  beforeEach(() => {
    mockPublishAndPartition.mockReset();
  });

  it("returns published/failed relay lists", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: [relays[0]], failed: [relays[1]] });

    const result = await sendAccept(bob.sk, bob.pk, alice.pk, relays);
    expect(result.published).toEqual([relays[0]]);
    expect(result.failed).toEqual([relays[1]]);
  });

  it("sends an accept message with d2a tag", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: relays, failed: [] });
    await sendAccept(bob.sk, bob.pk, alice.pk, relays);

    const [signedEvent] = mockPublishAndPartition.mock.calls[0];
    const d2aTag = signedEvent.tags.find((t: string[]) => t[0] === "d2a");
    expect(d2aTag).toBeTruthy();
    expect(d2aTag[1]).toBe("aegis-d2a-accept");
  });

  it("throws when all relays fail", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: [], failed: relays });
    await expect(sendAccept(bob.sk, bob.pk, alice.pk, relays)).rejects.toThrow();
  });
});

describe("sendReject", () => {
  beforeEach(() => {
    mockPublishAndPartition.mockReset();
  });

  it("sends a reject message", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: relays, failed: [] });
    const result = await sendReject(bob.sk, bob.pk, alice.pk, relays);
    expect(result.published).toEqual(relays);

    const [signedEvent] = mockPublishAndPartition.mock.calls[0];
    const d2aTag = signedEvent.tags.find((t: string[]) => t[0] === "d2a");
    expect(d2aTag[1]).toBe("aegis-d2a-reject");
  });
});

describe("deliverContent", () => {
  beforeEach(() => {
    mockPublishAndPartition.mockReset();
  });

  it("sends a deliver message with full content payload", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: relays, failed: [] });

    const payload: D2ADeliverPayload = {
      text: "Full article about transformers",
      author: "Dr. Smith",
      scores: { originality: 8, insight: 9, credibility: 7, composite: 8.2 },
      verdict: "quality",
      topics: ["ai", "ml"],
      vSignal: 9,
      cContext: 7,
      lSlop: 2,
    };

    const result = await deliverContent(alice.sk, alice.pk, bob.pk, payload, relays);
    expect(result.published).toEqual(relays);

    const [signedEvent] = mockPublishAndPartition.mock.calls[0];
    const d2aTag = signedEvent.tags.find((t: string[]) => t[0] === "d2a");
    expect(d2aTag[1]).toBe("aegis-d2a-deliver");
    // Target peer should be in p tag
    expect(signedEvent.tags).toContainEqual(["p", bob.pk]);
  });

  it("throws when all relays fail", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({ published: [], failed: relays });

    const payload: D2ADeliverPayload = {
      text: "Test",
      author: "Test",
      scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      verdict: "quality",
      topics: [],
    };

    await expect(deliverContent(alice.sk, alice.pk, bob.pk, payload, relays)).rejects.toThrow();
  });
});
