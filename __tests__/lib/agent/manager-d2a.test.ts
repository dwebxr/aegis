/**
 * Tests for AgentManager D2A match callback, concurrent behavior,
 * and state transitions.
 */
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { D2ADeliverPayload } from "@/lib/agent/types";

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
  v4: jest.fn().mockReturnValue("test-uuid-d2a"),
}));

import { AgentManager } from "@/lib/agent/manager";

function makeCallbacks(overrides?: Partial<{
  prefs: UserPreferenceProfile;
  content: ContentItem[];
}>) {
  const prefs = overrides?.prefs ?? {
    ...createEmptyProfile("test-principal"),
    topicAffinities: { ai: 0.8, ml: 0.5 },
  };
  const content = overrides?.content ?? [];
  return {
    callbacks: {
      onNewContent: jest.fn(),
      getContent: jest.fn().mockReturnValue(content),
      getPrefs: jest.fn().mockReturnValue(prefs),
      onStateChange: jest.fn(),
      onD2AMatchComplete: jest.fn(),
    },
    prefs,
    content,
  };
}

describe("AgentManager — D2A match callback", () => {
  const sk = new Uint8Array(32).fill(5);
  const pk = "my-d2a-test-pubkey";
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

  it("fires onD2AMatchComplete on valid delivery with known peer principal", async () => {
    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"], "my-ic-principal");

    // Register a peer with principalId
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "sender-with-principal",
      principalId: "abc-123-principal",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    await mgr.start();

    // Simulate delivery
    mockParseD2AMessage.mockReturnValue({
      type: "deliver",
      fromPubkey: "sender-with-principal",
      toPubkey: pk,
      payload: {
        text: "Content from peer",
        author: "Peer Author",
        scores: { originality: 7, insight: 8, credibility: 6, composite: 7.2 },
        verdict: "quality",
        topics: ["ai"],
      } as D2ADeliverPayload,
    });
    mockCalculateResonance.mockReturnValue(0.5);

    onEventHandler({ pubkey: "sender-with-principal", content: "encrypted-deliver" });
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onD2AMatchComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onD2AMatchComplete).toHaveBeenCalledWith(
      "sender-with-principal",
      "abc-123-principal",
      expect.any(String),
    );
    expect(mgr.getState().d2aMatchCount).toBe(1);

    mgr.stop();
  });

  it("rejects delivery from unknown peer (not in discovered peers map)", async () => {
    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "deliver",
      fromPubkey: "unknown-peer",
      toPubkey: pk,
      payload: {
        text: "Unknown peer content",
        author: "Unknown",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 },
        verdict: "quality",
        topics: [],
      } as D2ADeliverPayload,
    });

    onEventHandler({ pubkey: "unknown-peer", content: "encrypted-deliver" });
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onNewContent).not.toHaveBeenCalled();
    expect(callbacks.onD2AMatchComplete).not.toHaveBeenCalled();
    expect(mgr.getState().receivedItems).toBe(0);

    mgr.stop();
  });

  it("does not fire onD2AMatchComplete when callback is not provided", async () => {
    const { callbacks } = makeCallbacks();
    delete (callbacks as Record<string, unknown>).onD2AMatchComplete;
    mockCalculateResonance.mockReturnValue(0.5);

    // Peer must be discovered first
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "deliver",
      fromPubkey: "peer",
      toPubkey: pk,
      payload: {
        text: "Content",
        author: "Author",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 },
        verdict: "quality",
        topics: [],
      } as D2ADeliverPayload,
    });

    onEventHandler({ pubkey: "peer", content: "deliver" });
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onNewContent).toHaveBeenCalledTimes(1);
    expect(mgr.getState().receivedItems).toBe(1);
    expect(mgr.getState().d2aMatchCount).toBe(0);

    mgr.stop();
  });

  it("rejects delivery when resonance is very low (< 0.1) for known peer", async () => {
    const { callbacks } = makeCallbacks();
    mockCalculateResonance.mockReturnValue(0.05); // Below 0.1 threshold

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);

    // Register peer
    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "low-resonance-peer",
      interests: ["cooking"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "deliver",
      fromPubkey: "low-resonance-peer",
      toPubkey: pk,
      payload: {
        text: "Irrelevant content",
        author: "Chef",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 },
        verdict: "quality",
        topics: ["cooking"],
      } as D2ADeliverPayload,
    });

    onEventHandler({ pubkey: "low-resonance-peer", content: "deliver" });
    await new Promise(r => setTimeout(r, 50));

    expect(callbacks.onNewContent).not.toHaveBeenCalled();
    expect(mgr.getState().receivedItems).toBe(0);

    mgr.stop();
  });

  it("increments d2aMatchCount on each successful delivery", async () => {
    const { callbacks } = makeCallbacks();
    mockCalculateResonance.mockReturnValue(0.5);

    // Register all 3 peers before start
    mockDiscoverPeers.mockResolvedValueOnce([
      { nostrPubkey: "peer-0", interests: ["ai"], capacity: 5, lastSeen: Date.now() },
      { nostrPubkey: "peer-1", interests: ["ai"], capacity: 5, lastSeen: Date.now() },
      { nostrPubkey: "peer-2", interests: ["ai"], capacity: 5, lastSeen: Date.now() },
    ]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    for (let i = 0; i < 3; i++) {
      mockParseD2AMessage.mockReturnValue({
        type: "deliver",
        fromPubkey: `peer-${i}`,
        toPubkey: pk,
        payload: {
          text: `Content ${i}`,
          author: `Author ${i}`,
          scores: { originality: 7, insight: 7, credibility: 7, composite: 7.0 },
          verdict: "quality",
          topics: ["ai"],
        } as D2ADeliverPayload,
      });

      onEventHandler({ pubkey: `peer-${i}`, content: `deliver-${i}` });
      await new Promise(r => setTimeout(r, 30));
    }

    expect(mgr.getState().d2aMatchCount).toBe(3);
    expect(mgr.getState().receivedItems).toBe(3);

    mgr.stop();
  });

  it("uses content preview (first 32 chars of text) for match callback", async () => {
    const { callbacks } = makeCallbacks();
    mockCalculateResonance.mockReturnValue(0.5);

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-preview",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const longText = "A".repeat(100);
    mockParseD2AMessage.mockReturnValue({
      type: "deliver",
      fromPubkey: "peer-preview",
      toPubkey: pk,
      payload: {
        text: longText,
        author: "Author",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5.0 },
        verdict: "quality",
        topics: [],
      } as D2ADeliverPayload,
    });

    onEventHandler({ pubkey: "peer-preview", content: "deliver" });
    await new Promise(r => setTimeout(r, 50));

    const contentPreview = callbacks.onD2AMatchComplete.mock.calls[0][2];
    expect(contentPreview).toBe("A".repeat(32));
    expect(contentPreview.length).toBe(32);

    mgr.stop();
  });
});

describe("AgentManager — offer filtering", () => {
  const sk = new Uint8Array(32).fill(6);
  const pk = "my-offer-test-pubkey";

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  it("only offers quality content with score >= MIN_OFFER_SCORE", async () => {
    const lowScoreItem: ContentItem = {
      id: "low-1",
      owner: "owner",
      author: "A",
      avatar: "A",
      text: "Low quality content",
      source: "manual",
      scores: { originality: 3, insight: 3, credibility: 3, composite: 3.0 },
      verdict: "quality",
      reason: "",
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "now",
      topics: ["ai"],
    };

    const highScoreItem: ContentItem = {
      id: "high-1",
      owner: "owner",
      author: "A",
      avatar: "A",
      text: "High quality AI research",
      source: "manual",
      scores: { originality: 9, insight: 9, credibility: 8, composite: 8.5 },
      verdict: "quality",
      reason: "",
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "now",
      topics: ["ai"],
    };

    const { callbacks } = makeCallbacks({ content: [lowScoreItem, highScoreItem] });
    callbacks.getContent.mockReturnValue([lowScoreItem, highScoreItem]);

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-xyz",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);
    mockSendOffer.mockResolvedValue({
      peerId: "peer-xyz",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 8.5,
      startedAt: Date.now(),
    });

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // sendOffer MUST have been called (peer has matching interest "ai")
    expect(mockSendOffer).toHaveBeenCalled();
    // The offered content must be the high-score one, not the low-score one
    const offeredPayload = mockSendOffer.mock.calls[0][3];
    expect(offeredPayload.score).toBeGreaterThanOrEqual(7.0);

    mgr.stop();
  });

  it("does not offer slop content regardless of score", async () => {
    const slopItem: ContentItem = {
      id: "slop-1",
      owner: "owner",
      author: "A",
      avatar: "A",
      text: "Slop content",
      source: "manual",
      scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 },
      verdict: "slop",
      reason: "",
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "now",
      topics: ["ai"],
    };

    const { callbacks } = makeCallbacks({ content: [slopItem] });
    callbacks.getContent.mockReturnValue([slopItem]);

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-no-slop",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    expect(mockSendOffer).not.toHaveBeenCalled();

    mgr.stop();
  });

  it("does not offer content without topics", async () => {
    const noTopicItem: ContentItem = {
      id: "notopic-1",
      owner: "owner",
      author: "A",
      avatar: "A",
      text: "No topic content",
      source: "manual",
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9.0 },
      verdict: "quality",
      reason: "",
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "now",
      // no topics
    };

    const { callbacks } = makeCallbacks({ content: [noTopicItem] });
    callbacks.getContent.mockReturnValue([noTopicItem]);

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "peer-nt",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    expect(mockSendOffer).not.toHaveBeenCalled();

    mgr.stop();
  });
});

describe("AgentManager — state inspection", () => {
  const sk = new Uint8Array(32).fill(7);
  const pk = "my-state-test-pubkey";

  beforeEach(() => {
    jest.clearAllMocks();
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  it("getState returns correct initial state before start", () => {
    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    const state = mgr.getState();
    expect(state.isActive).toBe(false);
    expect(state.myPubkey).toBe(pk);
    expect(state.peers).toEqual([]);
    expect(state.activeHandshakes).toEqual([]);
    expect(state.receivedItems).toBe(0);
    expect(state.sentItems).toBe(0);
    expect(state.d2aMatchCount).toBe(0);
    expect(state.consecutiveErrors).toBe(0);
    expect(state.lastError).toBeUndefined();
  });

  it("getState returns active after start", async () => {
    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();
    expect(mgr.getState().isActive).toBe(true);
    mgr.stop();
    expect(mgr.getState().isActive).toBe(false);
  });

  it("passes principalId to broadcastPresence", async () => {
    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"], "my-ic-principal");
    await mgr.start();

    expect(mockBroadcastPresence).toHaveBeenCalledWith(
      sk,
      expect.any(Array),
      5,
      ["wss://test.relay"],
      "my-ic-principal",
    );

    mgr.stop();
  });
});
