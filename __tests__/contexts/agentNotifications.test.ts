import type { AgentState } from "@/lib/agent/types";

// Mirrors AgentContext notification logic — data-layer only, no React state
function detectAgentEvents(prev: AgentState, curr: AgentState): string[] {
  const events: string[] = [];

  // Skip if agent just became active (initial state flood)
  if (!prev.isActive && curr.isActive) return events;
  // Skip if agent stopped
  if (!curr.isActive) return events;

  if (curr.receivedItems > prev.receivedItems) {
    const count = curr.receivedItems - prev.receivedItems;
    events.push(`Received ${count} item${count > 1 ? "s" : ""} from D2A peer`);
  }
  if (curr.sentItems > prev.sentItems) {
    const count = curr.sentItems - prev.sentItems;
    events.push(`Sent ${count} item${count > 1 ? "s" : ""} to D2A peer`);
  }
  if (curr.d2aMatchCount > prev.d2aMatchCount) {
    events.push("D2A fee-paid match completed");
  }
  if (curr.peers.length > prev.peers.length && prev.peers.length > 0) {
    const newCount = curr.peers.length - prev.peers.length;
    events.push(`Discovered ${newCount} new D2A peer${newCount > 1 ? "s" : ""}`);
  }
  if (curr.consecutiveErrors > 0 && curr.lastError && curr.lastError !== prev.lastError) {
    events.push(`D2A Agent error: ${curr.lastError.slice(0, 80)}`);
  }

  return events;
}

const baseState: AgentState = {
  isActive: true,
  myPubkey: "abc123",
  peers: [],
  activeHandshakes: [],
  receivedItems: 0,
  sentItems: 0,
  d2aMatchCount: 0,
  consecutiveErrors: 0,
  activityLog: [],
};

describe("D2A event notifications", () => {
  it("detects content received from peer", () => {
    const prev = { ...baseState, receivedItems: 2 };
    const curr = { ...baseState, receivedItems: 3 };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual(["Received 1 item from D2A peer"]);
  });

  it("detects multiple items received", () => {
    const prev = { ...baseState, receivedItems: 0 };
    const curr = { ...baseState, receivedItems: 3 };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual(["Received 3 items from D2A peer"]);
  });

  it("detects content sent to peer", () => {
    const prev = { ...baseState, sentItems: 1 };
    const curr = { ...baseState, sentItems: 2 };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual(["Sent 1 item to D2A peer"]);
  });

  it("detects D2A match completed", () => {
    const prev = { ...baseState, d2aMatchCount: 0 };
    const curr = { ...baseState, d2aMatchCount: 1 };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual(["D2A fee-paid match completed"]);
  });

  it("detects new peers discovered (only when there were existing peers)", () => {
    const peer = { nostrPubkey: "pk1", interests: [], capacity: 3, lastSeen: Date.now() };
    const prev = { ...baseState, peers: [peer] };
    const curr = { ...baseState, peers: [peer, { ...peer, nostrPubkey: "pk2" }] };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual(["Discovered 1 new D2A peer"]);
  });

  it("does NOT notify on initial peer discovery (from 0 peers)", () => {
    const peer = { nostrPubkey: "pk1", interests: [], capacity: 3, lastSeen: Date.now() };
    const prev = { ...baseState, peers: [] };
    const curr = { ...baseState, peers: [peer] };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual([]);
  });

  it("detects agent errors", () => {
    const prev = { ...baseState, consecutiveErrors: 0 };
    const curr = { ...baseState, consecutiveErrors: 1, lastError: "Relay connection failed" };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual(["D2A Agent error: Relay connection failed"]);
  });

  it("does NOT re-notify for the same error", () => {
    const prev = { ...baseState, consecutiveErrors: 1, lastError: "Same error" };
    const curr = { ...baseState, consecutiveErrors: 2, lastError: "Same error" };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual([]);
  });

  it("suppresses notifications when agent just activated", () => {
    const prev = { ...baseState, isActive: false };
    const curr = { ...baseState, isActive: true, receivedItems: 5, sentItems: 3 };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual([]);
  });

  it("suppresses notifications when agent is inactive", () => {
    const prev = { ...baseState, receivedItems: 1 };
    const curr = { ...baseState, isActive: false, receivedItems: 5 };
    const events = detectAgentEvents(prev, curr);
    expect(events).toEqual([]);
  });

  it("detects multiple simultaneous events", () => {
    const peer = { nostrPubkey: "pk1", interests: [], capacity: 3, lastSeen: Date.now() };
    const prev = { ...baseState, peers: [peer], receivedItems: 1, sentItems: 1, d2aMatchCount: 0 };
    const curr = {
      ...baseState,
      peers: [peer, { ...peer, nostrPubkey: "pk2" }, { ...peer, nostrPubkey: "pk3" }],
      receivedItems: 2,
      sentItems: 3,
      d2aMatchCount: 1,
    };
    const events = detectAgentEvents(prev, curr);
    expect(events).toHaveLength(4);
    expect(events).toContain("Received 1 item from D2A peer");
    expect(events).toContain("Sent 2 items to D2A peer");
    expect(events).toContain("D2A fee-paid match completed");
    expect(events).toContain("Discovered 2 new D2A peers");
  });

  it("truncates long error messages", () => {
    const longError = "x".repeat(200);
    const prev = { ...baseState };
    const curr = { ...baseState, consecutiveErrors: 1, lastError: longError };
    const events = detectAgentEvents(prev, curr);
    expect(events[0].length).toBeLessThanOrEqual(80 + "D2A Agent error: ".length);
  });
});
