import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";

let mockIsAuthenticated = true;
let mockIsEnabled = false;
let mockAgentState = {
  peers: [] as { nostrPubkey: string }[],
  activeHandshakes: [] as { peerId: string }[],
  receivedItems: 0,
  sentItems: 0,
};

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
  }),
}));

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({
    agentState: mockAgentState,
    isEnabled: mockIsEnabled,
    toggleAgent: jest.fn(),
  }),
}));

describe("AgentStatusBadge — returns null when not authenticated", () => {
  beforeEach(() => {
    mockIsAuthenticated = false;
    mockIsEnabled = false;
    mockAgentState = { peers: [], activeHandshakes: [], receivedItems: 0, sentItems: 0 };
  });

  it("renders nothing when not authenticated", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toBe("");
  });

  it("renders nothing in compact mode when not authenticated", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge compact />);
    expect(html).toBe("");
  });
});

describe("AgentStatusBadge — full mode, agent disabled", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockIsEnabled = false;
    mockAgentState = { peers: [], activeHandshakes: [], receivedItems: 0, sentItems: 0 };
  });

  it("shows D2A Agent label and Start button", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("D2A Agent");
    expect(html).toContain("Start");
    expect(html).not.toContain("Stop");
  });

  it("does not show peer/handshake stats when disabled", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).not.toContain("peers");
    expect(html).not.toContain("active");
  });
});

describe("AgentStatusBadge — full mode, agent enabled", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockIsEnabled = true;
    mockAgentState = {
      peers: [{ nostrPubkey: "peer1" }, { nostrPubkey: "peer2" }],
      activeHandshakes: [{ peerId: "peer1" }],
      receivedItems: 5,
      sentItems: 3,
    };
  });

  it("shows Stop button when enabled", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("Stop");
    expect(html).not.toContain("Start");
  });

  it("shows peer count", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("2");
    expect(html).toContain("peers");
  });

  it("shows active handshake count", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("1");
    expect(html).toContain("active");
  });

  it("shows received and sent item counts", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("5");
    expect(html).toContain("3");
  });
});

describe("AgentStatusBadge — compact mode", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockIsEnabled = false;
    mockAgentState = { peers: [], activeHandshakes: [], receivedItems: 0, sentItems: 0 };
  });

  it("shows D2A label and Start button in compact mode", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge compact />);
    expect(html).toContain("D2A");
    expect(html).toContain("Start");
  });

  it("shows Stop button when enabled in compact mode", () => {
    mockIsEnabled = true;
    const html = renderToStaticMarkup(<AgentStatusBadge compact />);
    expect(html).toContain("Stop");
  });

  it("does not show detailed stats in compact mode", () => {
    mockIsEnabled = true;
    mockAgentState = { peers: [{ nostrPubkey: "peer1" }], activeHandshakes: [], receivedItems: 3, sentItems: 1 };
    const html = renderToStaticMarkup(<AgentStatusBadge compact />);
    // Compact mode doesn't show peers/active stats
    expect(html).not.toContain("peers");
    expect(html).not.toContain("active");
  });
});

describe("AgentStatusBadge — zero state", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockIsEnabled = true;
    mockAgentState = { peers: [], activeHandshakes: [], receivedItems: 0, sentItems: 0 };
  });

  it("shows zero counts correctly", () => {
    const html = renderToStaticMarkup(<AgentStatusBadge />);
    expect(html).toContain("0");
    expect(html).toContain("peers");
  });
});
