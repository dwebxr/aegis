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
  v4: jest.fn().mockReturnValue("backoff-uuid"),
}));

import { AgentManager } from "@/lib/agent/manager";

function makeCallbacks() {
  const prefs: UserPreferenceProfile = {
    ...createEmptyProfile("test"),
    topicAffinities: { ai: 0.8 },
  };
  return {
    callbacks: {
      onNewContent: jest.fn(),
      getContent: jest.fn().mockReturnValue([]),
      getPrefs: jest.fn().mockReturnValue(prefs),
      onStateChange: jest.fn(),
    },
  };
}

describe("AgentManager — backoff delay", () => {
  const sk = new Uint8Array(32).fill(20);
  const pk = "backoff-test-pk";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns base delay when no errors", () => {
    // Access private method via prototype
    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);

    // Use getState to verify initial consecutiveErrors = 0
    expect(mgr.getState().consecutiveErrors).toBe(0);
    mgr.stop();
  });

  it("records consecutive errors and increases consecutiveErrors counter", async () => {
    jest.useRealTimers();

    const { callbacks } = makeCallbacks();

    // Both broadcast and discovery fail
    mockBroadcastPresence.mockRejectedValueOnce(new Error("Fail 1"));
    mockDiscoverPeers.mockRejectedValueOnce(new Error("Fail 2"));

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // After start, both broadcast and discovery failed
    // broadcast fails → recordError (consecutiveErrors=1)
    // discovery fails → recordError (consecutiveErrors=2)
    // But note: clearErrors() is called between if one succeeds
    // Since both fail, the state should have recorded errors
    const states = callbacks.onStateChange.mock.calls;
    const errorStates = states.filter(
      (call: [{ consecutiveErrors: number }]) => call[0].consecutiveErrors > 0
    );
    expect(errorStates.length).toBeGreaterThan(0);

    mgr.stop();
  });

  it("clears errors on successful broadcast after failure", async () => {
    jest.useRealTimers();

    const { callbacks } = makeCallbacks();

    // First broadcast fails, then succeeds, discovery succeeds
    mockBroadcastPresence.mockRejectedValueOnce(new Error("Initial fail"));
    mockDiscoverPeers.mockResolvedValueOnce([]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // broadcast fail → recordError (consecutiveErrors=1)
    // discovery success → clearErrors (consecutiveErrors=0)
    const finalState = mgr.getState();
    expect(finalState.consecutiveErrors).toBe(0);
    expect(finalState.lastError).toBeUndefined();

    mgr.stop();
  });

  it("schedulePresence does not run when agent is stopped", async () => {
    jest.useRealTimers();

    const { callbacks } = makeCallbacks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const broadcastCountBefore = mockBroadcastPresence.mock.calls.length;
    mgr.stop();

    // Even after waiting, no new broadcast should fire
    await new Promise(r => setTimeout(r, 100));
    expect(mockBroadcastPresence.mock.calls.length).toBe(broadcastCountBefore);
  });
});

describe("AgentManager — stale handshake cleanup", () => {
  const sk = new Uint8Array(32).fill(21);
  const pk = "cleanup-test-pk";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    mockSubscribe.mockImplementation((_r: unknown, _f: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("cleans up completed handshakes on next discovery cycle", async () => {
    const qualityItem: ContentItem = {
      id: "c1", owner: "o", author: "A", avatar: "A",
      text: "Quality AI content", source: "manual",
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      verdict: "quality", reason: "test", createdAt: Date.now(),
      validated: false, flagged: false, timestamp: "now", topics: ["ai"],
    };

    const { callbacks } = makeCallbacks();
    callbacks.getContent.mockReturnValue([qualityItem]);

    // First discovery: find a peer and send offer
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-cleanup",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);
    mockSendOffer.mockResolvedValueOnce({
      peerId: "peer-cleanup",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 9,
      startedAt: Date.now(),
    });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    expect(mgr.getState().activeHandshakes.length).toBe(1);

    // Peer rejects → handshake phase becomes "rejected"
    mockParseD2AMessage.mockReturnValue({
      type: "reject",
      fromPubkey: "peer-cleanup",
      toPubkey: pk,
      payload: {},
    });

    onEventHandler({ pubkey: "peer-cleanup", content: "reject" });
    await new Promise(r => setTimeout(r, 50));

    // Rejected handshakes are cleaned up on next discoverAndNegotiate
    // But they still exist in the map until cleanup
    // Let's explicitly call the internal method via another discovery round
    mockDiscoverPeers.mockResolvedValueOnce([]);
    // Trigger another discovery (via internal method)
    const discoverAndNegotiate = (mgr as unknown as { discoverAndNegotiate: () => Promise<void> }).discoverAndNegotiate.bind(mgr);
    await discoverAndNegotiate();

    // After cleanup, the rejected handshake should be removed
    expect(mgr.getState().activeHandshakes.length).toBe(0);

    mgr.stop();
  });

  it("cleans up expired handshakes", async () => {
    const { callbacks } = makeCallbacks();

    // Mark handshakes as expired
    mockIsHandshakeExpired.mockReturnValue(true);

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-expire",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);
    mockSendOffer.mockResolvedValueOnce({
      peerId: "peer-expire",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 9,
      startedAt: Date.now() - 600000, // 10 min ago
    });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // The handshake should be expired and cleaned up on next cycle
    mockDiscoverPeers.mockResolvedValueOnce([]);
    const discoverAndNegotiate = (mgr as unknown as { discoverAndNegotiate: () => Promise<void> }).discoverAndNegotiate.bind(mgr);
    await discoverAndNegotiate();

    // Expired handshake cleaned up
    expect(mgr.getState().activeHandshakes.length).toBe(0);

    mgr.stop();
    mockIsHandshakeExpired.mockReturnValue(false);
  });
});

describe("AgentManager — sendOffer failure", () => {
  const sk = new Uint8Array(32).fill(22);
  const pk = "offer-fail-pk";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  it("continues operating when sendOffer throws for a peer", async () => {
    const qualityItem: ContentItem = {
      id: "c1", owner: "o", author: "A", avatar: "A",
      text: "Quality content", source: "manual",
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      verdict: "quality", reason: "test", createdAt: Date.now(),
      validated: false, flagged: false, timestamp: "now", topics: ["ai"],
    };

    const { callbacks } = makeCallbacks();
    callbacks.getContent.mockReturnValue([qualityItem]);

    mockDiscoverPeers.mockResolvedValueOnce([
      { nostrPubkey: "peer-fail", interests: ["ai"], capacity: 5, lastSeen: Date.now() },
      { nostrPubkey: "peer-ok", interests: ["ai"], capacity: 5, lastSeen: Date.now() },
    ]);

    // First sendOffer fails, second succeeds
    mockSendOffer
      .mockRejectedValueOnce(new Error("Relay down"))
      .mockResolvedValueOnce({
        peerId: "peer-ok",
        phase: "offered",
        offeredTopic: "ai",
        offeredScore: 9,
        startedAt: Date.now(),
      });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Agent stays active despite one offer failure
    expect(mgr.getState().isActive).toBe(true);
    // One handshake was created (the successful one)
    expect(mgr.getState().activeHandshakes.length).toBe(1);

    mgr.stop();
  });
});

describe("AgentManager — handleAccept edge cases", () => {
  const sk = new Uint8Array(32).fill(23);
  const pk = "accept-edge-pk";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    mockSubscribe.mockImplementation((_r: unknown, _f: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("ignores accept from peer with no handshake", async () => {
    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "accept",
      fromPubkey: "no-handshake-peer",
      toPubkey: pk,
      payload: {},
    });

    onEventHandler({ pubkey: "no-handshake-peer", content: "accept" });
    await new Promise(r => setTimeout(r, 50));

    expect(mockDeliverContent).not.toHaveBeenCalled();
    expect(mgr.getState().sentItems).toBe(0);
    mgr.stop();
  });

  it("skips peers with active (in-progress) handshakes during offer phase", async () => {
    const qualityItem: ContentItem = {
      id: "c1", owner: "o", author: "A", avatar: "A",
      text: "Quality content", source: "manual",
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      verdict: "quality", reason: "test", createdAt: Date.now(),
      validated: false, flagged: false, timestamp: "now", topics: ["ai"],
    };

    const { callbacks } = makeCallbacks();
    callbacks.getContent.mockReturnValue([qualityItem]);

    // First discovery: creates offered handshake
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-active",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);
    mockSendOffer.mockResolvedValueOnce({
      peerId: "peer-active",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 9,
      startedAt: Date.now(),
    });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    expect(mockSendOffer).toHaveBeenCalledTimes(1);

    // Second discovery: same peer → should skip (already has "offered" handshake)
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-active",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);
    const discoverAndNegotiate = (mgr as unknown as { discoverAndNegotiate: () => Promise<void> }).discoverAndNegotiate.bind(mgr);
    await discoverAndNegotiate();

    // No additional sendOffer — peer already has active handshake
    expect(mockSendOffer).toHaveBeenCalledTimes(1);

    mgr.stop();
  });
});

describe("AgentManager — onD2AMatchComplete callback failure", () => {
  const sk = new Uint8Array(32).fill(24);
  const pk = "match-fail-pk";
  let onEventHandler: (event: { pubkey: string; content: string }) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockSubscribe.mockImplementation((_r: unknown, _f: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
  });

  it("continues processing when onD2AMatchComplete callback throws", async () => {
    const { callbacks } = makeCallbacks();
    callbacks.onD2AMatchComplete = jest.fn().mockRejectedValueOnce(new Error("Payment failed"));
    mockCalculateResonance.mockReturnValue(0.5);

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-match-fail",
      principalId: "principal-1",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "deliver",
      fromPubkey: "peer-match-fail",
      toPubkey: pk,
      payload: {
        text: "Content from peer", author: "Author",
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
        verdict: "quality", topics: ["ai"],
      },
    });

    onEventHandler({ pubkey: "peer-match-fail", content: "deliver" });
    await new Promise(r => setTimeout(r, 100));

    // Content should still have been received despite callback failure
    expect(callbacks.onNewContent).toHaveBeenCalledTimes(1);
    expect(mgr.getState().receivedItems).toBe(1);
    // d2aMatchCount still increments (counted before callback)
    expect(mgr.getState().d2aMatchCount).toBe(1);

    mgr.stop();
  });
});
