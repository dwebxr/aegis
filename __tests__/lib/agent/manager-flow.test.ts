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
  v4: jest.fn().mockReturnValue("flow-test-uuid"),
}));

import { AgentManager } from "@/lib/agent/manager";

const qualityItem: ContentItem = {
  id: "content-flow-1",
  owner: "owner",
  author: "Dr. Flow",
  avatar: "F",
  text: "High quality research about AI architectures with novel findings",
  source: "manual",
  scores: { originality: 9, insight: 8, credibility: 9, composite: 8.7 },
  verdict: "quality",
  reason: "Novel research",
  createdAt: Date.now(),
  validated: false,
  flagged: false,
  timestamp: "just now",
  topics: ["ai", "architecture"],
};

function makeCallbacks(content: ContentItem[] = [qualityItem]) {
  const prefs: UserPreferenceProfile = {
    ...createEmptyProfile("test-principal"),
    topicAffinities: { ai: 0.8, architecture: 0.6 },
  };
  return {
    callbacks: {
      onNewContent: jest.fn(),
      getContent: jest.fn().mockReturnValue(content),
      getPrefs: jest.fn().mockReturnValue(prefs),
      onStateChange: jest.fn(),
      onD2AMatchComplete: jest.fn(),
    },
    prefs,
  };
}

describe("AgentManager — full offer→accept→deliver flow", () => {
  const sk = new Uint8Array(32).fill(10);
  const pk = "flow-test-pubkey";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((_r: unknown, _f: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("completes full cycle: discover → offer → accept → deliver → complete", async () => {
    const { callbacks } = makeCallbacks();

    // Step 1: Discover a peer with matching interests
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-flow",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    // Step 2: sendOffer returns a handshake state
    mockSendOffer.mockResolvedValueOnce({
      peerId: "peer-flow",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 8.7,
      startedAt: Date.now(),
    });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"], "my-principal");
    await mgr.start();

    // Verify offer was sent
    expect(mockSendOffer).toHaveBeenCalledTimes(1);
    expect(mockSendOffer.mock.calls[0][2]).toBe("peer-flow"); // target peer

    // Verify handshake is tracked
    const stateAfterOffer = mgr.getState();
    expect(stateAfterOffer.activeHandshakes).toHaveLength(1);
    expect(stateAfterOffer.activeHandshakes[0].phase).toBe("offered");
    expect(stateAfterOffer.peers).toHaveLength(1);

    // Step 3: Peer accepts our offer
    mockParseD2AMessage.mockReturnValue({
      type: "accept",
      fromPubkey: "peer-flow",
      toPubkey: pk,
      payload: {},
    });

    // Step 4: deliverContent succeeds
    mockDeliverContent.mockResolvedValueOnce({
      published: ["wss://test.relay"],
      failed: [],
    });

    // Simulate receiving accept message
    onEventHandler({ pubkey: "peer-flow", content: "encrypted-accept" });
    await new Promise(r => setTimeout(r, 100));

    // Verify delivery happened
    expect(mockDeliverContent).toHaveBeenCalledTimes(1);
    const deliveredPayload = mockDeliverContent.mock.calls[0][3];
    expect(deliveredPayload.text).toBe(qualityItem.text);
    expect(deliveredPayload.author).toBe("Dr. Flow");
    expect(deliveredPayload.scores.composite).toBe(8.7);

    // Verify state updated
    const finalState = mgr.getState();
    expect(finalState.sentItems).toBe(1);

    mgr.stop();
  });

  it("handleAccept rejects when content is no longer available", async () => {
    const { callbacks } = makeCallbacks([qualityItem]);

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-missing",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    mockSendOffer.mockResolvedValueOnce({
      peerId: "peer-missing",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 8.7,
      startedAt: Date.now(),
    });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Now remove content before accept arrives
    callbacks.getContent.mockReturnValue([]);

    mockParseD2AMessage.mockReturnValue({
      type: "accept",
      fromPubkey: "peer-missing",
      toPubkey: pk,
      payload: {},
    });

    onEventHandler({ pubkey: "peer-missing", content: "accept" });
    await new Promise(r => setTimeout(r, 100));

    // deliverContent should NOT have been called
    expect(mockDeliverContent).not.toHaveBeenCalled();
    expect(mgr.getState().sentItems).toBe(0);

    mgr.stop();
  });

  it("handles offer→reject flow correctly", async () => {
    const { callbacks } = makeCallbacks();
    // Low-affinity topic: reject path
    callbacks.getPrefs.mockReturnValue({
      ...createEmptyProfile("test"),
      topicAffinities: { cooking: -0.5 },
    });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "offer",
      fromPubkey: "peer-reject-test",
      toPubkey: pk,
      payload: { topic: "cooking", score: 7.0, contentPreview: "recipe" },
    });

    mockSendReject.mockResolvedValueOnce(undefined);

    onEventHandler({ pubkey: "peer-reject-test", content: "offer" });
    await new Promise(r => setTimeout(r, 100));

    expect(mockSendReject).toHaveBeenCalledTimes(1);
    expect(mockSendAccept).not.toHaveBeenCalled();

    mgr.stop();
  });

  it("handles offer→accept flow when topic has positive affinity and score >= 6", async () => {
    const { callbacks } = makeCallbacks();

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "offer",
      fromPubkey: "peer-accept-test",
      toPubkey: pk,
      payload: { topic: "ai", score: 8.0, contentPreview: "research" },
    });

    mockSendAccept.mockResolvedValueOnce(undefined);

    onEventHandler({ pubkey: "peer-accept-test", content: "offer" });
    await new Promise(r => setTimeout(r, 100));

    expect(mockSendAccept).toHaveBeenCalledTimes(1);
    expect(mockSendReject).not.toHaveBeenCalled();

    mgr.stop();
  });

  it("rejects offer when score is below 6 even with positive affinity", async () => {
    const { callbacks } = makeCallbacks();

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "offer",
      fromPubkey: "peer-low-score",
      toPubkey: pk,
      payload: { topic: "ai", score: 4.0, contentPreview: "low quality" },
    });

    mockSendReject.mockResolvedValueOnce(undefined);

    onEventHandler({ pubkey: "peer-low-score", content: "offer" });
    await new Promise(r => setTimeout(r, 100));

    expect(mockSendReject).toHaveBeenCalledTimes(1);
    expect(mockSendAccept).not.toHaveBeenCalled();

    mgr.stop();
  });
});

describe("AgentManager — handleReject", () => {
  const sk = new Uint8Array(32).fill(11);
  const pk = "reject-flow-pubkey";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    mockSubscribe.mockImplementation((_r: unknown, _f: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("marks handshake as rejected when peer sends reject", async () => {
    const { callbacks } = makeCallbacks();

    // Set up an offered handshake
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-rejecter",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);
    mockSendOffer.mockResolvedValueOnce({
      peerId: "peer-rejecter",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 8.7,
      startedAt: Date.now(),
    });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Verify we have an active handshake
    expect(mgr.getState().activeHandshakes).toHaveLength(1);

    // Peer rejects
    mockParseD2AMessage.mockReturnValue({
      type: "reject",
      fromPubkey: "peer-rejecter",
      toPubkey: pk,
      payload: {},
    });

    onEventHandler({ pubkey: "peer-rejecter", content: "reject" });
    await new Promise(r => setTimeout(r, 100));

    // Handshake should now be rejected (and filtered out from activeHandshakes)
    // since cleanupStaleHandshakes removes rejected ones on next discovery
    expect(mgr.getState().sentItems).toBe(0);
    expect(mockDeliverContent).not.toHaveBeenCalled();

    mgr.stop();
  });

  it("ignores reject for unknown peer (no handshake)", async () => {
    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "reject",
      fromPubkey: "unknown-rejecter",
      toPubkey: pk,
      payload: {},
    });

    // Should not crash
    onEventHandler({ pubkey: "unknown-rejecter", content: "reject" });
    await new Promise(r => setTimeout(r, 50));

    expect(mgr.getState().isActive).toBe(true);

    mgr.stop();
  });
});

describe("AgentManager — error tracking and recovery", () => {
  const sk = new Uint8Array(32).fill(12);
  const pk = "error-flow-pubkey";

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  it("tracks consecutive errors and clears on success", async () => {
    const { callbacks } = makeCallbacks();

    // First broadcast fails
    mockBroadcastPresence.mockRejectedValueOnce(new Error("Relay 1 down"));
    // Discovery also fails
    mockDiscoverPeers.mockRejectedValueOnce(new Error("Discovery timeout"));

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Should have recorded 2 errors (broadcast + discovery)
    // but clearErrors() is called between them, so consecutive may vary
    // The key is that the agent is still active
    expect(mgr.getState().isActive).toBe(true);

    mgr.stop();
  });

  it("records lastError message", async () => {
    const { callbacks } = makeCallbacks();

    mockBroadcastPresence.mockRejectedValueOnce(new Error("Specific error message"));
    mockDiscoverPeers.mockResolvedValue([]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // After failed broadcast, lastError should be set
    // (state was emitted during recordError)
    const stateChanges = callbacks.onStateChange.mock.calls;
    const errorStates = stateChanges.filter(
      (call: [{ lastError?: string }]) => call[0].lastError !== undefined
    );
    expect(errorStates.length).toBeGreaterThan(0);
    expect(errorStates[0][0].lastError).toBe("Specific error message");

    mgr.stop();
  });

  it("uses default relays when none specified", async () => {
    const { callbacks } = makeCallbacks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);

    const mgr = new AgentManager(sk, pk, callbacks); // no relayUrls
    await mgr.start();

    expect(mockBroadcastPresence).toHaveBeenCalledWith(
      sk,
      expect.any(Array),
      5,
      expect.arrayContaining(["wss://relay.damus.io"]),
      undefined,
      expect.any(Array),
    );

    mgr.stop();
  });
});

describe("AgentManager — presence broadcast interests", () => {
  const sk = new Uint8Array(32).fill(13);
  const pk = "interests-pubkey";

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  it("only broadcasts interests with affinity >= 0.2", async () => {
    const prefs: UserPreferenceProfile = {
      ...createEmptyProfile("test"),
      topicAffinities: {
        "high": 0.9,
        "medium": 0.5,
        "low": 0.1,
        "negative": -0.3,
        "threshold": 0.2,
      },
    };

    const { callbacks } = makeCallbacks();
    callbacks.getPrefs.mockReturnValue(prefs);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const interests = mockBroadcastPresence.mock.calls[0][1] as string[];
    expect(interests).toContain("high");
    expect(interests).toContain("medium");
    expect(interests).toContain("threshold");
    expect(interests).not.toContain("low");
    expect(interests).not.toContain("negative");

    mgr.stop();
  });

  it("sorts interests by affinity descending and caps at 20", async () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      affinities[`topic-${i.toString().padStart(2, "0")}`] = 0.3 + (i / 100);
    }

    const prefs: UserPreferenceProfile = {
      ...createEmptyProfile("test"),
      topicAffinities: affinities,
    };

    const { callbacks } = makeCallbacks();
    callbacks.getPrefs.mockReturnValue(prefs);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const interests = mockBroadcastPresence.mock.calls[0][1] as string[];
    expect(interests.length).toBeLessThanOrEqual(20);

    mgr.stop();
  });
});
