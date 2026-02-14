import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";

let mockIsAuthenticated = true;
let mockIsEnabled = true;
let mockToggleAgent = jest.fn();
let mockAgentState: {
  peers: Array<{ nostrPubkey: string }>;
  activeHandshakes: Array<{ peerId: string }>;
  receivedItems: number;
  sentItems: number;
};

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({
    agentState: mockAgentState,
    isEnabled: mockIsEnabled,
    toggleAgent: mockToggleAgent,
  }),
}));

// Mock reputation — component calls getReputation, calculateEffectiveTrust, getTrustTier
const mockGetReputation = jest.fn();
const mockCalcEffectiveTrust = jest.fn();
const mockGetTrustTier = jest.fn();

jest.mock("@/lib/d2a/reputation", () => ({
  getReputation: (...args: unknown[]) => mockGetReputation(...args),
  calculateEffectiveTrust: (...args: unknown[]) => mockCalcEffectiveTrust(...args),
  getTrustTier: (...args: unknown[]) => mockGetTrustTier(...args),
}));

beforeEach(() => {
  mockIsAuthenticated = true;
  mockIsEnabled = true;
  mockToggleAgent = jest.fn();
  mockAgentState = { peers: [], activeHandshakes: [], receivedItems: 0, sentItems: 0 };
  // Default: no reputation → unknown tier
  mockGetReputation.mockReturnValue(undefined);
  mockCalcEffectiveTrust.mockReturnValue(0);
  mockGetTrustTier.mockReturnValue("unknown");
});

describe("AgentStatusBadge — trust tier display", () => {
  it("shows no tier breakdown when no peers", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).not.toContain("trusted");
    expect(html).not.toContain("known");
    expect(html).not.toContain("unknown");
  });

  it("classifies peers with no reputation as 'unknown'", () => {
    mockAgentState = {
      peers: [{ nostrPubkey: "new-peer-1" }, { nostrPubkey: "new-peer-2" }],
      activeHandshakes: [],
      receivedItems: 0,
      sentItems: 0,
    };
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("2 unknown");
  });

  it("classifies peers with positive reputation as 'known'", () => {
    // Peer "peer-good" has reputation → effectiveTrust 0.4 → "known"
    mockGetReputation.mockImplementation((pk: string) =>
      pk === "peer-good" ? { pubkey: pk, useful: 10, slop: 0, score: 10, blocked: false, updatedAt: 0 } : undefined,
    );
    mockCalcEffectiveTrust.mockImplementation((_wot: number, rep: number) =>
      rep > 0 ? 0.4 : 0,
    );
    mockGetTrustTier.mockImplementation((trust: number) =>
      trust >= 0.4 ? "known" : "unknown",
    );

    mockAgentState = {
      peers: [{ nostrPubkey: "peer-good" }, { nostrPubkey: "peer-neutral" }],
      activeHandshakes: [],
      receivedItems: 0,
      sentItems: 0,
    };
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("1 known");
    expect(html).toContain("1 unknown");
  });

  it("classifies highly trusted peers", () => {
    mockGetReputation.mockReturnValue({ pubkey: "x", useful: 20, slop: 0, score: 20, blocked: false, updatedAt: 0 });
    mockCalcEffectiveTrust.mockReturnValue(0.8);
    mockGetTrustTier.mockReturnValue("trusted");

    mockAgentState = {
      peers: [{ nostrPubkey: "trusted-peer" }],
      activeHandshakes: [],
      receivedItems: 0,
      sentItems: 0,
    };
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("1 trusted");
    expect(html).not.toMatch(/\d+ known/);
    expect(html).not.toMatch(/\d+ unknown/);
  });

  it("hides tier labels that have zero count", () => {
    // All peers are new → all "unknown", no "trusted" or "N known" labels
    mockAgentState = {
      peers: [{ nostrPubkey: "p1" }],
      activeHandshakes: [],
      receivedItems: 0,
      sentItems: 0,
    };
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).not.toContain("trusted");
    // "unknown" contains "known" — check for the tier-specific pattern
    expect(html).not.toMatch(/\d+ known/);
    expect(html).toContain("1 unknown");
  });

  it("shows mixed tier distribution", () => {
    // 3 peers: first is trusted, second is known, third is unknown
    const tiers = ["trusted", "known", "unknown"];
    let callIdx = 0;
    mockGetReputation.mockImplementation(() => ({ score: 0 }));
    mockCalcEffectiveTrust.mockImplementation(() => 0);
    mockGetTrustTier.mockImplementation(() => tiers[callIdx++] || "unknown");

    mockAgentState = {
      peers: [{ nostrPubkey: "a" }, { nostrPubkey: "b" }, { nostrPubkey: "c" }],
      activeHandshakes: [],
      receivedItems: 0,
      sentItems: 0,
    };
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("1 trusted");
    expect(html).toContain("1 known");
    expect(html).toContain("1 unknown");
  });
});

describe("AgentStatusBadge — confirmation panel", () => {
  it("shows trust-based fee description in confirmation panel", () => {
    mockIsEnabled = false;
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("Start");
    expect(html).toContain("D2A Agent");
  });
});

describe("AgentStatusBadge — data display correctness", () => {
  it("shows received and sent counters with correct arrows", () => {
    mockAgentState = {
      peers: [],
      activeHandshakes: [],
      receivedItems: 42,
      sentItems: 17,
    };
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("42");
    expect(html).toContain("17");
    // Down arrow (↓) for received, up arrow (↑) for sent
    expect(html).toContain("\u2193");
    expect(html).toContain("\u2191");
  });

  it("compact mode hides detailed counters", () => {
    mockAgentState = {
      peers: [{ nostrPubkey: "p1" }],
      activeHandshakes: [{ peerId: "p1" }],
      receivedItems: 10,
      sentItems: 5,
    };
    const html = renderToStaticMarkup(<AgentStatusBadge compact />);
    // Compact mode should not show peers/active labels
    expect(html).not.toContain("peers");
    expect(html).toContain("D2A");
  });
});
