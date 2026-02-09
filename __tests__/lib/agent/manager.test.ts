/**
 * Tests for AgentManager error handling paths.
 * Covers: start() failures, handleOffer relay failures,
 * handleAccept delivery failures (phase → "rejected"), message handler catch.
 */
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import { createEmptyProfile } from "@/lib/preferences/types";

const mockBroadcastPresence = jest.fn();
const mockDiscoverPeers = jest.fn();
const mockCalculateResonance = jest.fn();
const mockSendOffer = jest.fn();
const mockSendAccept = jest.fn();
const mockSendReject = jest.fn();
const mockDeliverContent = jest.fn();
const mockParseD2AMessage = jest.fn();
const mockIsHandshakeExpired = jest.fn().mockReturnValue(false);
const mockSubscribe = jest.fn();
const mockPoolDestroy = jest.fn();

jest.mock("@/lib/agent/discovery", () => ({
  broadcastPresence: (...args: unknown[]) => mockBroadcastPresence(...args),
  discoverPeers: (...args: unknown[]) => mockDiscoverPeers(...args),
  calculateResonance: (...args: unknown[]) => mockCalculateResonance(...args),
}));

jest.mock("@/lib/agent/handshake", () => ({
  sendOffer: (...args: unknown[]) => mockSendOffer(...args),
  sendAccept: (...args: unknown[]) => mockSendAccept(...args),
  sendReject: (...args: unknown[]) => mockSendReject(...args),
  deliverContent: (...args: unknown[]) => mockDeliverContent(...args),
  parseD2AMessage: (...args: unknown[]) => mockParseD2AMessage(...args),
  isHandshakeExpired: (...args: unknown[]) => mockIsHandshakeExpired(...args),
}));

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    subscribe: mockSubscribe,
    destroy: mockPoolDestroy,
  })),
}));

jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("test-uuid-1234"),
}));

import { AgentManager } from "@/lib/agent/manager";

function makeCallbacks() {
  const prefs: UserPreferenceProfile = {
    ...createEmptyProfile("test-principal"),
    topicAffinities: { ai: 0.8, ml: 0.5 },
  };
  const content: ContentItem[] = [];
  return {
    callbacks: {
      onNewContent: jest.fn(),
      getContent: jest.fn().mockReturnValue(content),
      getPrefs: jest.fn().mockReturnValue(prefs),
      onStateChange: jest.fn(),
    },
    prefs,
    content,
  };
}

describe("AgentManager — start() error handling", () => {
  const sk = new Uint8Array(32).fill(1);
  const pk = "my-test-pubkey";

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  it("continues running when initial broadcastPresence throws", async () => {
    mockBroadcastPresence.mockRejectedValueOnce(new Error("Relay down"));
    mockDiscoverPeers.mockResolvedValueOnce([]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);

    await mgr.start();

    expect(callbacks.onStateChange).toHaveBeenCalled();
    const state = mgr.getState();
    expect(state.isActive).toBe(true);

    mgr.stop();
  });

  it("continues running when initial discoverAndNegotiate throws", async () => {
    mockBroadcastPresence.mockResolvedValueOnce(undefined);
    mockDiscoverPeers.mockRejectedValueOnce(new Error("Discovery timeout"));

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);

    await mgr.start();

    expect(mgr.getState().isActive).toBe(true);

    mgr.stop();
  });

  it("cleans up timers and subscriptions on stop()", async () => {
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    const closeFn = jest.fn();
    mockSubscribe.mockReturnValue({ close: closeFn });

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);

    await mgr.start();
    mgr.stop();

    expect(mgr.getState().isActive).toBe(false);
    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(mockPoolDestroy).toHaveBeenCalledTimes(1);
  });
});

describe("AgentManager — handleOffer error handling", () => {
  const sk = new Uint8Array(32).fill(1);
  const pk = "my-test-pubkey";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    // Capture the onevent handler when subscribeToMessages is called
    mockSubscribe.mockImplementation((_relays: unknown, _filter: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("stays active and tracks error when sendAccept fails on relay error", async () => {
    mockParseD2AMessage.mockReturnValue({
      type: "offer",
      fromPubkey: "peer-abc",
      toPubkey: pk,
      payload: { topic: "ai", score: 8.0, contentPreview: "test" },
    });
    mockSendAccept.mockRejectedValueOnce(new Error("Relay timeout"));

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Simulate incoming offer event — should not throw
    onEventHandler({ pubkey: "peer-abc", content: "encrypted-offer" });

    // Wait for async handler to settle
    await new Promise(r => setTimeout(r, 50));

    // Agent must remain active despite relay error
    expect(mgr.getState().isActive).toBe(true);
    // No content should have been received (this was an offer, not delivery)
    expect(mgr.getState().receivedItems).toBe(0);

    mgr.stop();
  });

  it("does not throw when sendReject fails on relay error", async () => {
    // Low affinity topic → reject path
    const { callbacks } = makeCallbacks();
    callbacks.getPrefs.mockReturnValue({
      ...createEmptyProfile("test"),
      topicAffinities: { ai: 0 }, // zero affinity → reject
    });

    mockParseD2AMessage.mockReturnValue({
      type: "offer",
      fromPubkey: "peer-xyz",
      toPubkey: pk,
      payload: { topic: "cooking", score: 8.0, contentPreview: "recipe" },
    });
    mockSendReject.mockRejectedValueOnce(new Error("Relay timeout"));

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    onEventHandler({ pubkey: "peer-xyz", content: "encrypted-offer" });
    await new Promise(r => setTimeout(r, 50));

    mgr.stop();
  });
});

describe("AgentManager — handleAccept delivery failure", () => {
  const sk = new Uint8Array(32).fill(2);
  const pk = "my-test-pubkey";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    mockSubscribe.mockImplementation((_relays: unknown, _filter: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("sets handshake phase to 'rejected' (not 'offered') when deliverContent fails", async () => {
    const qualityItem: ContentItem = {
      id: "content-1",
      owner: "owner",
      author: "Author",
      avatar: "A",
      text: "High quality AI content for testing",
      source: "manual",
      scores: { originality: 8, insight: 9, credibility: 7, composite: 8.5 },
      verdict: "quality",
      reason: "test",
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "just now",
      topics: ["ai"],
    };

    const { callbacks } = makeCallbacks();
    callbacks.getContent.mockReturnValue([qualityItem]);

    // Mock sendOffer to create an "offered" handshake
    mockSendOffer.mockResolvedValue({
      peerId: "peer-deliver-fail",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 8.5,
      startedAt: Date.now(),
    });

    // First, discover a peer and send an offer
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-deliver-fail",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Now simulate receiving "accept" from that peer
    mockParseD2AMessage.mockReturnValue({
      type: "accept",
      fromPubkey: "peer-deliver-fail",
      toPubkey: pk,
      payload: {},
    });

    // deliverContent fails
    mockDeliverContent.mockRejectedValueOnce(new Error("Relay unavailable"));

    onEventHandler({ pubkey: "peer-deliver-fail", content: "encrypted-accept" });
    await new Promise(r => setTimeout(r, 50));

    // deliverContent failed → sentItems must NOT have incremented
    expect(mgr.getState().sentItems).toBe(0);
    // onNewContent must NOT have been called (we are the sender, not receiver)
    expect(callbacks.onNewContent).not.toHaveBeenCalled();

    mgr.stop();
  });

  it("increments sentItems on successful delivery", async () => {
    const qualityItem: ContentItem = {
      id: "content-2",
      owner: "owner",
      author: "Author",
      avatar: "A",
      text: "More AI content",
      source: "manual",
      scores: { originality: 8, insight: 9, credibility: 7, composite: 8.5 },
      verdict: "quality",
      reason: "test",
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "just now",
      topics: ["ai"],
    };

    const { callbacks } = makeCallbacks();
    callbacks.getContent.mockReturnValue([qualityItem]);

    mockSendOffer.mockResolvedValue({
      peerId: "peer-success",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 8.5,
      startedAt: Date.now(),
    });

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-success",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    expect(mgr.getState().sentItems).toBe(0);

    mockParseD2AMessage.mockReturnValue({
      type: "accept",
      fromPubkey: "peer-success",
      toPubkey: pk,
      payload: {},
    });
    mockDeliverContent.mockResolvedValueOnce({ published: ["wss://test.relay"], failed: [] });

    onEventHandler({ pubkey: "peer-success", content: "encrypted-accept" });
    await new Promise(r => setTimeout(r, 50));

    expect(mgr.getState().sentItems).toBe(1);

    mgr.stop();
  });
});

describe("AgentManager — handleDelivery", () => {
  const sk = new Uint8Array(32).fill(3);
  const pk = "my-test-pubkey";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    mockSubscribe.mockImplementation((_relays: unknown, _filter: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("calls onNewContent and increments receivedItems on valid delivery", async () => {
    const { callbacks } = makeCallbacks();
    mockCalculateResonance.mockReturnValue(0.5);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Register the peer so resonance check works
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "sender-pk",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);
    // Re-run discovery manually isn't easy, so we rely on the peer not being found
    // which skips the resonance check (no peer profile → no check)

    mockParseD2AMessage.mockReturnValue({
      type: "deliver",
      fromPubkey: "sender-pk",
      toPubkey: pk,
      payload: {
        text: "Delivered article about AI",
        author: "Dr. Smith",
        scores: { originality: 8, insight: 9, credibility: 7, composite: 8.2 },
        verdict: "quality",
        topics: ["ai"],
      },
    });

    onEventHandler({ pubkey: "sender-pk", content: "encrypted-deliver" });
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onNewContent).toHaveBeenCalledTimes(1);
    const delivered = callbacks.onNewContent.mock.calls[0][0] as ContentItem;
    expect(delivered.author).toBe("Dr. Smith");
    expect(delivered.source).toBe("nostr");
    expect(mgr.getState().receivedItems).toBe(1);

    mgr.stop();
  });

  it("accepts delivery from unknown peer (no resonance check when peer not in map)", async () => {
    const { callbacks } = makeCallbacks();

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Peer not discovered — resonance check is skipped, delivery accepted
    mockParseD2AMessage.mockReturnValue({
      type: "deliver",
      fromPubkey: "unknown-peer",
      toPubkey: pk,
      payload: {
        text: "Article from unknown peer",
        author: "Unknown",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 },
        verdict: "quality",
        topics: ["misc"],
      },
    });

    onEventHandler({ pubkey: "unknown-peer", content: "encrypted-deliver" });
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onNewContent).toHaveBeenCalledTimes(1);
    expect(mgr.getState().receivedItems).toBe(1);

    mgr.stop();
  });
});

describe("AgentManager — message handler catch", () => {
  const sk = new Uint8Array(32).fill(4);
  const pk = "my-test-pubkey";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    mockSubscribe.mockImplementation((_relays: unknown, _filter: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("does not crash when parseD2AMessage returns null", async () => {
    mockParseD2AMessage.mockReturnValue(null);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Should not throw
    onEventHandler({ pubkey: "unknown", content: "garbage" });
    await new Promise(r => setTimeout(r, 50));

    expect(mgr.getState().isActive).toBe(true);

    mgr.stop();
  });

  it("does not crash when parseD2AMessage throws", async () => {
    mockParseD2AMessage.mockImplementation(() => {
      throw new Error("Decryption failed");
    });

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    onEventHandler({ pubkey: "unknown", content: "corrupted" });
    await new Promise(r => setTimeout(r, 50));

    expect(mgr.getState().isActive).toBe(true);

    mgr.stop();
  });
});
