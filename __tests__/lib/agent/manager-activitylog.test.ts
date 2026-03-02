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

describe("AgentManager — activity log", () => {
  const sk = new Uint8Array(32).fill(5);
  const pk = "actlog-test-pubkey";

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  it("includes activityLog in getState()", async () => {
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const state = mgr.getState();
    expect(Array.isArray(state.activityLog)).toBe(true);

    mgr.stop();
  });

  it("logs presence broadcast on start()", async () => {
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const state = mgr.getState();
    const presenceLogs = state.activityLog.filter(e => e.type === "presence");
    expect(presenceLogs.length).toBe(1);
    expect(presenceLogs[0].message).toContain("Broadcast presence");

    mgr.stop();
  });

  it("logs peer discovery", async () => {
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValueOnce([
      { nostrPubkey: "peer-1", interests: ["ai"], capacity: 5, lastSeen: Date.now() },
      { nostrPubkey: "peer-2", interests: ["ml"], capacity: 3, lastSeen: Date.now() },
    ]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const state = mgr.getState();
    const discoveryLogs = state.activityLog.filter(e => e.type === "discovery");
    expect(discoveryLogs.length).toBe(1);
    expect(discoveryLogs[0].message).toMatch(/Discovered \d+ peer/);

    mgr.stop();
  });

  it("logs errors via recordError", async () => {
    mockBroadcastPresence.mockRejectedValueOnce(new Error("Relay offline"));
    mockDiscoverPeers.mockResolvedValue([]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const state = mgr.getState();
    const errorLogs = state.activityLog.filter(e => e.type === "error");
    expect(errorLogs.length).toBe(1);
    expect(errorLogs[0].message).toContain("Relay offline");

    mgr.stop();
  });

  it("each log entry has required fields", async () => {
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const state = mgr.getState();
    expect(state.activityLog.length).toBeGreaterThan(0);

    for (const entry of state.activityLog) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.timestamp).toBe("number");
      expect(typeof entry.type).toBe("string");
      expect(typeof entry.message).toBe("string");
    }

    mgr.stop();
  });

  it("newest entries are first (unshift order)", async () => {
    mockBroadcastPresence.mockResolvedValue(undefined);
    // Two separate calls to generate multiple log entries in sequence
    mockDiscoverPeers.mockResolvedValueOnce([
      { nostrPubkey: "peer-1", interests: ["ai"], capacity: 5, lastSeen: Date.now() },
    ]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const state = mgr.getState();
    // The log should be in reverse chronological order (newest first)
    for (let i = 0; i < state.activityLog.length - 1; i++) {
      expect(state.activityLog[i].timestamp).toBeGreaterThanOrEqual(state.activityLog[i + 1].timestamp);
    }

    mgr.stop();
  });

  it("returns a defensive copy of activityLog (not a reference)", async () => {
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    const state1 = mgr.getState();
    const state2 = mgr.getState();
    expect(state1.activityLog).not.toBe(state2.activityLog);
    expect(state1.activityLog).toEqual(state2.activityLog);

    mgr.stop();
  });

  it("logs offer_received when handling an incoming offer", async () => {
    let onEventHandler: (event: { pubkey: string; content: string }) => void;
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValueOnce([
      { nostrPubkey: "offer-sender", interests: ["ai"], capacity: 5, lastSeen: Date.now() },
    ]);
    mockSubscribe.mockImplementation((_r: unknown, _f: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });
    mockSendAccept.mockResolvedValue(undefined);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    mockParseD2AMessage.mockReturnValue({
      type: "offer",
      fromPubkey: "offer-sender",
      toPubkey: pk,
      payload: { topic: "ai", score: 8.0, contentPreview: "test" },
    });

    onEventHandler!({ pubkey: "offer-sender", content: "encrypted-offer" });
    await new Promise(r => setTimeout(r, 50));

    const state = mgr.getState();
    const offerReceivedLogs = state.activityLog.filter(e => e.type === "offer_received");
    expect(offerReceivedLogs.length).toBe(1);
    expect(offerReceivedLogs[0].message).toContain("ai");
    expect(offerReceivedLogs[0].peerId).toBe("offer-sender");

    mgr.stop();
  });
});

describe("AgentManager — activity log cap", () => {
  const sk = new Uint8Array(32).fill(6);
  const pk = "logcap-test-pubkey";

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscribe.mockReturnValue({ close: jest.fn() });
  });

  it("caps activity log at 50 entries", async () => {
    // Each error generates a log entry via recordError → addLog
    mockBroadcastPresence.mockResolvedValue(undefined);
    mockDiscoverPeers.mockResolvedValue([]);

    const { callbacks } = makeCallbacks();
    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // After start, we have at least a "presence" log.
    // Now trigger many errors to fill the log past 50
    // We can't directly call addLog, but recordError calls it.
    // We'll trigger errors by having broadcastPresence fail many times in scheduled calls.
    // Simpler: use message handler to trigger many events.

    // Instead, we can observe the cap via onStateChange.
    // Let's count the max log length seen across all onStateChange calls
    let maxLogLen = 0;
    callbacks.onStateChange.mockImplementation((state: { activityLog: unknown[] }) => {
      if (state.activityLog.length > maxLogLen) {
        maxLogLen = state.activityLog.length;
      }
    });

    // Generate 55 errors via rejected broadcasts in rapid succession
    // But we can't easily do that without accessing private methods.
    // Let's use the message handler to trigger many parse failures.
    let onEventHandler: (event: { pubkey: string; content: string }) => void;
    mockSubscribe.mockImplementation((_r: unknown, _f: unknown, handlers: { onevent: typeof onEventHandler }) => {
      onEventHandler = handlers.onevent;
      return { close: jest.fn() };
    });

    // Restart to capture the new subscribe mock
    mgr.stop();
    const mgr2 = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr2.start();

    // parseD2AMessage returns null → "Unknown or unparseable message" won't throw
    // But if it throws, it generates error log entries
    mockParseD2AMessage.mockImplementation(() => {
      throw new Error("Parse error");
    });

    for (let i = 0; i < 55; i++) {
      onEventHandler!({ pubkey: `peer-${i}`, content: "garbage" });
    }
    await new Promise(r => setTimeout(r, 100));

    const state = mgr2.getState();
    expect(state.activityLog.length).toBeLessThanOrEqual(50);

    mgr2.stop();
  });
});

describe("AgentManager — log entries for reject flow", () => {
  const sk = new Uint8Array(32).fill(7);
  const pk = "reject-log-test-pubkey";
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

  it("logs when peer rejects our offer", async () => {
    const qualityItem: ContentItem = {
      id: "content-rej",
      owner: "owner",
      author: "Author",
      avatar: "A",
      text: "Interesting AI content",
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
      peerId: "rejecting-peer",
      phase: "offered",
      offeredTopic: "ai",
      offeredScore: 8.5,
      startedAt: Date.now(),
    });

    mockDiscoverPeers.mockResolvedValueOnce([{
      nostrPubkey: "rejecting-peer",
      interests: ["ai"],
      capacity: 5,
      lastSeen: Date.now(),
    }]);

    const mgr = new AgentManager(sk, pk, callbacks, ["wss://test.relay"]);
    await mgr.start();

    // Now peer sends reject
    mockParseD2AMessage.mockReturnValue({
      type: "reject",
      fromPubkey: "rejecting-peer",
      toPubkey: pk,
      payload: {},
    });

    onEventHandler!({ pubkey: "rejecting-peer", content: "encrypted-reject" });
    await new Promise(r => setTimeout(r, 50));

    const state = mgr.getState();
    const rejectLogs = state.activityLog.filter(e => e.type === "reject");
    expect(rejectLogs.length).toBe(1);
    expect(rejectLogs[0].message).toContain("Peer rejected");

    mgr.stop();
  });
});
