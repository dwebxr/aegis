/**
 * @jest-environment jsdom
 */
// Security gate: with D2A_SUBSYSTEM_ENABLED === false (the production default), the
// AgentProvider must NEVER instantiate/start the AgentManager — no presence,
// discovery, offer/accept/deliver, or allowance pre-approval — even for a fully
// authenticated, D2A-enabled user with derived Nostr keys. This is the client half
// of the D2A dormancy fix (the canister enforces the payment half independently).
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";

const managerInstances: unknown[] = [];
class MockAgentManager {
  start = jest.fn();
  stop = jest.fn();
  setWoTGraph = jest.fn();
  constructor() {
    managerInstances.push(this);
  }
}
const mockCreateLedgerActor = jest.fn().mockResolvedValue({
  icrc2_approve: jest.fn().mockResolvedValue({ Ok: 1n }),
});

// Flag OFF — the whole point of this file.
jest.mock("@/lib/agent/config", () => ({ __esModule: true, D2A_SUBSYSTEM_ENABLED: false }));
jest.mock("@/lib/agent/manager", () => ({ __esModule: true, AgentManager: MockAgentManager }));
jest.mock("@/lib/agent/handshake", () => ({ __esModule: true, sendComment: jest.fn() }));
jest.mock("@/lib/d2a/comments", () => ({
  __esModule: true,
  saveComment: jest.fn(),
  loadComments: () => [],
  clearOldComments: jest.fn(),
}));
jest.mock("@/lib/nostr/profile", () => ({
  __esModule: true,
  fetchAgentProfile: jest.fn().mockResolvedValue(null),
  getCachedAgentProfile: () => null,
  setCachedAgentProfile: jest.fn(),
}));
jest.mock("@/lib/nostr/linkAccount", () => ({
  __esModule: true,
  syncLinkedAccountToIC: jest.fn().mockResolvedValue(undefined),
  getLinkedAccount: () => null,
}));
jest.mock("@/lib/nostr/identity", () => ({
  __esModule: true,
  deriveNostrKeypairFromText: () => ({ sk: new Uint8Array(32), pk: "pk-hex-aaaaaaaaaaaaaaaa" }),
}));
jest.mock("@/lib/ic/actor", () => ({
  __esModule: true,
  createBackendActorAsync: jest.fn().mockResolvedValue({ recordD2AMatch: jest.fn() }),
}));
jest.mock("@/lib/ic/icpLedger", () => ({
  __esModule: true,
  createICPLedgerActorAsync: (...a: unknown[]) => mockCreateLedgerActor(...a),
  ICP_FEE: 10000n,
}));
jest.mock("@/lib/ic/agent", () => ({
  __esModule: true,
  getCanisterId: () => "rluf3-eiaaa-aaaam-qgjuq-cai",
}));

const mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
jest.mock("@/contexts/AuthContext", () => ({ __esModule: true, useAuth: () => mockAuthValue }));
jest.mock("@/contexts/PreferenceContext", () => ({ __esModule: true, usePreferences: () => ({ profile: { topics: ["ai"] } }) }));
jest.mock("@/contexts/ContentContext", () => ({ __esModule: true, useContent: () => ({ content: [], addContent: jest.fn() }) }));
jest.mock("@/contexts/NotificationContext", () => ({ __esModule: true, useNotify: () => ({ addNotification: jest.fn() }) }));

import React from "react";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { AgentProvider, useAgent } from "@/contexts/AgentContext";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(AgentProvider, null, children);

afterEach(() => {
  managerInstances.length = 0;
  cleanup();
});

describe("AgentProvider — D2A dormant (D2A_SUBSYSTEM_ENABLED=false)", () => {
  it("never starts the AgentManager even when the user enables D2A", async () => {
    const { result } = renderHook(() => useAgent(), { wrapper });

    // Authenticated + keys derived, but D2A is globally dormant.
    await waitFor(() => expect(result.current.nostrKeys).not.toBeNull());

    // User flips their personal D2A toggle on — the master switch must still win.
    await act(async () => {
      result.current.setD2AEnabled(true);
    });
    await act(async () => { await Promise.resolve(); });

    expect(managerInstances).toHaveLength(0);
    expect(result.current.agentState.isActive).toBe(false);
    // The EFFECTIVE enabled flag stays false so downstream privacy gates (e.g.
    // BriefingTab's on-chain briefing sync, which reads useAgent().isEnabled) never
    // fire — the master switch must win over the internal toggle / restored setting.
    expect(result.current.isEnabled).toBe(false);
    // And no ICP allowance pre-approval was attempted.
    expect(mockCreateLedgerActor).not.toHaveBeenCalled();
  });
});
