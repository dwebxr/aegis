import type { AgentState } from "@/lib/agent/types";

/**
 * Pure function that mirrors the checklist logic in D2ATab Exchanges empty state.
 * Extracted here for unit testing without React rendering.
 */
function buildExchangeChecklist(state: AgentState) {
  return [
    { done: true, text: "Agent identity established" },
    { done: true, text: "Broadcasting presence to relays" },
    { done: state.peers.length > 0, text: `Discovering compatible peers (${state.peers.length} found)` },
    { done: state.activeHandshakes.length > 0 || state.sentItems > 0, text: "Negotiating content exchange" },
  ];
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

describe("D2A Exchanges checklist", () => {
  it("identity and broadcasting are always checked", () => {
    const checklist = buildExchangeChecklist(baseState);
    expect(checklist[0].done).toBe(true);
    expect(checklist[1].done).toBe(true);
  });

  it("peer discovery is unchecked when no peers", () => {
    const checklist = buildExchangeChecklist(baseState);
    expect(checklist[2].done).toBe(false);
    expect(checklist[2].text).toContain("0 found");
  });

  it("peer discovery is checked when peers exist", () => {
    const state = {
      ...baseState,
      peers: [{ nostrPubkey: "pk1", interests: [], capacity: 3, lastSeen: Date.now() }],
    };
    const checklist = buildExchangeChecklist(state);
    expect(checklist[2].done).toBe(true);
    expect(checklist[2].text).toContain("1 found");
  });

  it("negotiating is unchecked with no handshakes and no sent items", () => {
    const checklist = buildExchangeChecklist(baseState);
    expect(checklist[3].done).toBe(false);
  });

  it("negotiating is checked when activeHandshakes exist", () => {
    const state = {
      ...baseState,
      activeHandshakes: [{
        peerId: "pk1",
        phase: "offered" as const,
        offeredTopic: "ai",
        offeredScore: 8,
        startedAt: Date.now(),
      }],
    };
    const checklist = buildExchangeChecklist(state);
    expect(checklist[3].done).toBe(true);
  });

  it("negotiating is checked when sentItems > 0 (past handshakes completed)", () => {
    const state = { ...baseState, sentItems: 2 };
    const checklist = buildExchangeChecklist(state);
    expect(checklist[3].done).toBe(true);
  });

  it("shows correct peer count in text", () => {
    const state = {
      ...baseState,
      peers: [
        { nostrPubkey: "pk1", interests: [], capacity: 3, lastSeen: Date.now() },
        { nostrPubkey: "pk2", interests: [], capacity: 3, lastSeen: Date.now() },
        { nostrPubkey: "pk3", interests: [], capacity: 3, lastSeen: Date.now() },
      ],
    };
    const checklist = buildExchangeChecklist(state);
    expect(checklist[2].text).toContain("3 found");
  });
});
