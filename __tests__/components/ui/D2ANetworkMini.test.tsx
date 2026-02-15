import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { D2ANetworkMini } from "@/components/ui/D2ANetworkMini";

const mockAgentState: {
  isActive: boolean;
  myPubkey: string | null;
  peers: Array<{ nostrPubkey: string; interests: string[]; capacity: number; lastSeen: number; resonance?: number }>;
  activeHandshakes: Array<{ peerId: string; phase: string; offeredTopic: string; offeredScore: number; startedAt: number }>;
  receivedItems: number;
  sentItems: number;
  d2aMatchCount: number;
  consecutiveErrors: number;
} = {
  isActive: false,
  myPubkey: null,
  peers: [],
  activeHandshakes: [],
  receivedItems: 0,
  sentItems: 0,
  d2aMatchCount: 0,
  consecutiveErrors: 0,
};

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({
    agentState: mockAgentState,
    wotGraph: null,
  }),
}));

jest.mock("@/lib/d2a/reputation", () => ({
  getReputation: () => undefined,
  calculateEffectiveTrust: (w: number, r: number) => w * 0.6 + Math.max(0, Math.min(1, r / 10)) * 0.4,
  getTrustTier: (t: number) => (t >= 0.8 ? "trusted" : t >= 0.4 ? "known" : t >= 0 ? "unknown" : "restricted"),
}));

jest.mock("@/lib/wot/scorer", () => ({
  calculateWoTScore: () => ({ trustScore: 0 }),
}));

function render(mobile?: boolean) {
  return renderToStaticMarkup(<D2ANetworkMini mobile={mobile} />);
}

describe("D2ANetworkMini", () => {
  beforeEach(() => {
    mockAgentState.isActive = false;
    mockAgentState.myPubkey = null;
    mockAgentState.peers = [];
    mockAgentState.activeHandshakes = [];
    mockAgentState.receivedItems = 0;
    mockAgentState.sentItems = 0;
  });

  it("returns null when agent is inactive", () => {
    const html = render();
    expect(html).toBe("");
  });

  it("returns null when agent is active but no peers", () => {
    mockAgentState.isActive = true;
    mockAgentState.myPubkey = "abc";
    const html = render();
    expect(html).toBe("");
  });

  it("renders SVG with peer nodes when active with peers", () => {
    mockAgentState.isActive = true;
    mockAgentState.myPubkey = "abc";
    mockAgentState.peers = [
      { nostrPubkey: "peer1", interests: ["crypto"], capacity: 5, lastSeen: Date.now(), resonance: 0.7 },
      { nostrPubkey: "peer2", interests: ["ai"], capacity: 3, lastSeen: Date.now(), resonance: 0.5 },
    ];
    mockAgentState.receivedItems = 3;
    mockAgentState.sentItems = 2;

    const html = render();
    expect(html).toContain("D2A Network");
    expect(html).toContain("<svg");
    expect(html).toContain("<circle");
    // User center node + 2 peer nodes = 3+ circles
    const circleCount = (html.match(/<circle/g) || []).length;
    expect(circleCount).toBeGreaterThanOrEqual(3);
    // Stats
    expect(html).toContain("2"); // peers count
    expect(html).toContain("3"); // receivedItems
  });

  it("shows overflow indicator when more than 8 peers", () => {
    mockAgentState.isActive = true;
    mockAgentState.myPubkey = "abc";
    mockAgentState.peers = Array.from({ length: 11 }, (_, i) => ({
      nostrPubkey: `peer-${i}`,
      interests: ["test"],
      capacity: 5,
      lastSeen: Date.now(),
      resonance: 0.5,
    }));

    const html = render();
    expect(html).toContain("+3");
  });

  it("renders handshake lines with dash array", () => {
    mockAgentState.isActive = true;
    mockAgentState.myPubkey = "abc";
    mockAgentState.peers = [
      { nostrPubkey: "peer1", interests: ["crypto"], capacity: 5, lastSeen: Date.now(), resonance: 0.7 },
    ];
    mockAgentState.activeHandshakes = [
      { peerId: "peer1", phase: "offered", offeredTopic: "crypto", offeredScore: 8, startedAt: Date.now() },
    ];

    const html = render();
    expect(html).toContain("stroke-dasharray");
  });

  it("renders in mobile mode without errors", () => {
    mockAgentState.isActive = true;
    mockAgentState.myPubkey = "abc";
    mockAgentState.peers = [
      { nostrPubkey: "peer1", interests: ["crypto"], capacity: 5, lastSeen: Date.now() },
    ];
    const html = render(true);
    expect(html).toContain("D2A Network");
  });
});
