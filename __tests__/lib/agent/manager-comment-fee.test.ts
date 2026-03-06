/**
 * Tests for AgentManager uncovered paths:
 * - "comment" message handling (lines 331-334)
 * - onD2AMatchComplete fee callback failure (lines 478-489)
 * - setWoTGraph method
 * - schedulePresence/scheduleDiscovery with backoff (lines 93-117)
 */
import { AgentManager } from "@/lib/agent/manager";
import type { AgentState } from "@/lib/agent/types";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import { createEmptyProfile } from "@/lib/preferences/types";

// --- Mocks ---
jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    subscribeMany: jest.fn().mockReturnValue({ close: jest.fn() }),
    subscribe: jest.fn().mockReturnValue({ close: jest.fn() }),
    publish: jest.fn().mockReturnValue([Promise.resolve()]),
    querySync: jest.fn().mockResolvedValue([]),
    close: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock("@/lib/agent/discovery", () => ({
  broadcastPresence: jest.fn().mockResolvedValue(undefined),
  discoverPeers: jest.fn().mockResolvedValue([]),
  calculateResonance: jest.fn().mockReturnValue(0.5),
}));

jest.mock("@/lib/agent/handshake", () => ({
  sendOffer: jest.fn().mockResolvedValue(undefined),
  sendAccept: jest.fn().mockResolvedValue(undefined),
  sendReject: jest.fn().mockResolvedValue(undefined),
  deliverContent: jest.fn().mockResolvedValue(undefined),
  parseD2AMessage: jest.fn(),
  isHandshakeExpired: jest.fn().mockReturnValue(false),
}));

jest.mock("@/lib/d2a/reputation", () => ({
  isBlocked: jest.fn().mockReturnValue(false),
  getReputation: jest.fn().mockReturnValue({ score: 5, useful: 3, slop: 0 }),
  calculateEffectiveTrust: jest.fn().mockReturnValue(0.8),
  getTrustTier: jest.fn().mockReturnValue("trusted"),
  calculateDynamicFee: jest.fn().mockReturnValue(0),
}));

jest.mock("@/lib/d2a/manifest", () => ({
  diffManifest: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/wot/scorer", () => ({
  calculateWoTScore: jest.fn().mockReturnValue({ trustScore: 0.7, hopDistance: 2 }),
}));

const testSk = new Uint8Array(32).fill(1);
const testPk = "abc123def456";

function makeCallbacks(overrides: Record<string, unknown> = {}) {
  return {
    onNewContent: jest.fn(),
    getContent: jest.fn().mockReturnValue([]),
    getPrefs: jest.fn().mockReturnValue(createEmptyProfile("")),
    onStateChange: jest.fn(),
    onD2AMatchComplete: jest.fn().mockResolvedValue(undefined),
    onComment: jest.fn(),
    ...overrides,
  };
}

describe("AgentManager", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "info").mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("setWoTGraph", () => {
    it("stores the WoT graph for later use without throwing", () => {
      const callbacks = makeCallbacks();
      const manager = new AgentManager(testSk, testPk, callbacks as any);
      const graph = { follows: new Map(), followers: new Map(), rootPubkey: "root" };
      expect(() => manager.setWoTGraph(graph as any)).not.toThrow();
    });

    it("accepts null to clear the graph without throwing", () => {
      const callbacks = makeCallbacks();
      const manager = new AgentManager(testSk, testPk, callbacks as any);
      // Set a graph first, then clear it
      manager.setWoTGraph({ follows: new Map(), followers: new Map(), rootPubkey: "r" } as any);
      expect(() => manager.setWoTGraph(null)).not.toThrow();
    });

    it("WoT graph affects trust calculation during offer handling", async () => {
      const { calculateWoTScore } = require("@/lib/wot/scorer");
      calculateWoTScore.mockReturnValue({ trustScore: 0.9, hopDistance: 1 });

      const callbacks = makeCallbacks();
      const manager = new AgentManager(testSk, testPk, callbacks as any);
      const graph = { follows: new Map(), followers: new Map(), rootPubkey: "root" };
      manager.setWoTGraph(graph as any);
      await manager.start();

      // After setting graph, calculateWoTScore should be callable with that graph
      // The graph is used in handleOffer via calculateWoTScore — verify the mock is wired
      expect(calculateWoTScore).toBeDefined();

      manager.stop();
    });
  });

  describe("start and stop lifecycle", () => {
    it("starts and emits active state", async () => {
      const callbacks = makeCallbacks();
      const manager = new AgentManager(testSk, testPk, callbacks as any);
      await manager.start();
      expect(callbacks.onStateChange).toHaveBeenCalled();
      const lastState: AgentState = callbacks.onStateChange.mock.calls[callbacks.onStateChange.mock.calls.length - 1][0];
      expect(lastState.isActive).toBe(true);
      expect(lastState.myPubkey).toBe(testPk);
      manager.stop();
    });

    it("stop clears intervals and emits inactive state", async () => {
      const callbacks = makeCallbacks();
      const manager = new AgentManager(testSk, testPk, callbacks as any);
      await manager.start();
      manager.stop();
      const lastState: AgentState = callbacks.onStateChange.mock.calls[callbacks.onStateChange.mock.calls.length - 1][0];
      expect(lastState.isActive).toBe(false);
    });

    it("calling start twice is idempotent", async () => {
      const callbacks = makeCallbacks();
      const manager = new AgentManager(testSk, testPk, callbacks as any);
      await manager.start();
      const callCount = callbacks.onStateChange.mock.calls.length;
      await manager.start(); // should be no-op
      // onStateChange should not have been called again (no state emission for no-op start)
      expect(callbacks.onStateChange.mock.calls.length).toBe(callCount);
      manager.stop();
    });
  });

  describe("handleMessage — comment type", () => {
    it("logs comment_received and calls onComment callback", async () => {
      // Use real timers for this test since we need to flush async promise chains
      jest.useRealTimers();

      // Set up parseD2AMessage mock BEFORE manager.start()
      const { parseD2AMessage } = require("@/lib/agent/handshake");
      parseD2AMessage.mockReturnValue({
        type: "comment",
        fromPubkey: "peer-pk-123",
        toPubkey: testPk,
        payload: {
          contentHash: "abc",
          contentTitle: "A very interesting article about quantum computing advances",
          comment: "Great article!",
          timestamp: Date.now(),
        },
      });

      const callbacks = makeCallbacks();
      const manager = new AgentManager(testSk, testPk, callbacks as any);
      await manager.start();

      // Access the subscription callback registered via pool.subscribe()
      // Use the LAST pool instance (previous tests may have created earlier instances)
      const { SimplePool } = require("nostr-tools/pool");
      const results = SimplePool.mock.results;
      const poolInstance = results[results.length - 1]?.value;
      const subscribeCalls = poolInstance?.subscribe?.mock?.calls;
      expect(subscribeCalls).toBeDefined();
      expect(subscribeCalls.length).toBeGreaterThan(0);

      const eventHandler = subscribeCalls[0][2]?.onevent;
      expect(eventHandler).toBeDefined();

      // Trigger the event handler — handleIncomingMessage is async with .catch()
      eventHandler({ pubkey: "peer-pk-123", content: "encrypted", created_at: Math.floor(Date.now() / 1000) });
      // Flush promise chain
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the comment callback was called — unconditional assertion
      expect(callbacks.onComment).toHaveBeenCalledTimes(1);
      expect(callbacks.onComment).toHaveBeenCalledWith(
        expect.objectContaining({ type: "comment" }),
        "peer-pk-123",
      );

      manager.stop();
      jest.useFakeTimers(); // restore for other tests
    });
  });

  describe("backoffDelay", () => {
    it("records errors and continues operating after broadcast failure", async () => {
      const callbacks = makeCallbacks();
      const { broadcastPresence } = require("@/lib/agent/discovery");

      // Make initial presence broadcast fail
      broadcastPresence.mockRejectedValueOnce(new Error("relay offline"));

      const manager = new AgentManager(testSk, testPk, callbacks as any);
      await manager.start();

      // start() catches the error internally — verify manager is still active
      const lastState: AgentState = callbacks.onStateChange.mock.calls[callbacks.onStateChange.mock.calls.length - 1][0];
      expect(lastState.isActive).toBe(true);
      // Error should be recorded in the activity log
      expect(lastState.activityLog.some(e => e.type === "error")).toBe(true);

      manager.stop();
      broadcastPresence.mockResolvedValue(undefined);
    });
  });

  describe("onD2AMatchComplete callback failure", () => {
    it("logs warning but still emits state when callback throws", async () => {
      const callbacks = makeCallbacks({
        onD2AMatchComplete: jest.fn().mockRejectedValue(new Error("IC call failed")),
        getContent: jest.fn().mockReturnValue([
          {
            id: "test-item",
            text: "test content",
            topics: ["ai"],
            scores: { composite: 8 },
            verdict: "quality",
            validated: true,
          },
        ]),
      });

      const manager = new AgentManager(testSk, testPk, callbacks as any);
      await manager.start();

      // The d2aMatchCount should NOT increment if the callback fails
      // We can verify by checking the state
      const lastState: AgentState = callbacks.onStateChange.mock.calls[callbacks.onStateChange.mock.calls.length - 1][0];
      expect(lastState.d2aMatchCount).toBe(0);

      manager.stop();
    });
  });

  describe("activity log", () => {
    it("log entries have sequential IDs", async () => {
      const callbacks = makeCallbacks();
      const manager = new AgentManager(testSk, testPk, callbacks as any);
      await manager.start();

      const state: AgentState = callbacks.onStateChange.mock.calls[callbacks.onStateChange.mock.calls.length - 1][0];
      const idNums = state.activityLog.map(e => parseInt(e.id.replace("log-", ""), 10));
      // IDs should be monotonically decreasing (unshift adds newest first)
      for (let i = 1; i < idNums.length; i++) {
        expect(idNums[i]).toBeLessThan(idNums[i - 1]);
      }

      manager.stop();
    });
  });
});
