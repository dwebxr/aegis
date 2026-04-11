/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";

const mockSendComment = jest.fn().mockResolvedValue(undefined);
const mockSaveComment = jest.fn();
const mockLoadComments = jest.fn(() => [] as unknown[]);
const mockClearOldComments = jest.fn();
const mockFetchAgentProfile = jest.fn().mockResolvedValue(null);
const mockGetCachedAgentProfile = jest.fn().mockReturnValue(null);
const mockSetCachedAgentProfile = jest.fn();
const mockSyncLinkedAccountToIC = jest.fn().mockResolvedValue(undefined);
const mockGetLinkedAccount = jest.fn().mockReturnValue(null);
const mockDeriveNostr = jest.fn();
const mockCreateBackendActor = jest.fn().mockResolvedValue({
  recordD2AMatch: jest.fn().mockResolvedValue({ ok: null }),
});
const mockCreateLedgerActor = jest.fn().mockResolvedValue({
  icrc2_approve: jest.fn().mockResolvedValue({ Ok: 1n }),
});

const managerInstances: Array<{
  start: jest.Mock;
  stop: jest.Mock;
  setWoTGraph: jest.Mock;
  callbacks: Record<string, (...args: unknown[]) => unknown>;
  principalText: string | undefined;
}> = [];

class MockAgentManager {
  start: jest.Mock;
  stop: jest.Mock;
  setWoTGraph: jest.Mock;
  callbacks: Record<string, (...args: unknown[]) => unknown>;
  principalText: string | undefined;
  constructor(_sk: unknown, _pk: unknown, callbacks: Record<string, (...args: unknown[]) => unknown>, _wot: unknown, principalText?: string) {
    this.start = jest.fn();
    this.stop = jest.fn();
    this.setWoTGraph = jest.fn();
    this.callbacks = callbacks;
    this.principalText = principalText;
    managerInstances.push(this);
  }
}

jest.mock("@/lib/agent/manager", () => ({ __esModule: true, AgentManager: MockAgentManager }));
jest.mock("@/lib/agent/handshake", () => ({ __esModule: true, sendComment: (...a: unknown[]) => mockSendComment(...a) }));
jest.mock("@/lib/d2a/comments", () => ({
  __esModule: true,
  saveComment: (c: unknown) => mockSaveComment(c),
  loadComments: () => mockLoadComments(),
  clearOldComments: () => mockClearOldComments(),
}));
jest.mock("@/lib/nostr/profile", () => ({
  __esModule: true,
  fetchAgentProfile: (...a: unknown[]) => mockFetchAgentProfile(...a),
  getCachedAgentProfile: (k: string) => mockGetCachedAgentProfile(k),
  setCachedAgentProfile: (k: string, v: unknown) => mockSetCachedAgentProfile(k, v),
}));
jest.mock("@/lib/nostr/linkAccount", () => ({
  __esModule: true,
  syncLinkedAccountToIC: (...a: unknown[]) => mockSyncLinkedAccountToIC(...a),
  getLinkedAccount: () => mockGetLinkedAccount(),
}));
jest.mock("@/lib/nostr/identity", () => ({
  __esModule: true,
  deriveNostrKeypairFromText: (...a: unknown[]) => mockDeriveNostr(...a),
}));
jest.mock("@/lib/ic/actor", () => ({
  __esModule: true,
  createBackendActorAsync: (...a: unknown[]) => mockCreateBackendActor(...a),
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

let mockAuthValue: { isAuthenticated: boolean; identity: unknown; principalText: string };
let mockProfileValue: unknown;
let mockContentValue: { content: unknown[]; addContent: jest.Mock };
let mockNotifyValue: { addNotification: jest.Mock };

jest.mock("@/contexts/AuthContext", () => ({
  __esModule: true,
  useAuth: () => mockAuthValue,
}));
jest.mock("@/contexts/PreferenceContext", () => ({
  __esModule: true,
  usePreferences: () => ({ profile: mockProfileValue }),
}));
jest.mock("@/contexts/ContentContext", () => ({
  __esModule: true,
  useContent: () => mockContentValue,
}));
jest.mock("@/contexts/NotificationContext", () => ({
  __esModule: true,
  useNotify: () => mockNotifyValue,
}));

import React from "react";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { AgentProvider, useAgent } from "@/contexts/AgentContext";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(AgentProvider, null, children);

beforeEach(() => {
  managerInstances.length = 0;
  mockAuthValue = { isAuthenticated: false, identity: null, principalText: "" };
  mockProfileValue = { topics: [] };
  mockContentValue = { content: [], addContent: jest.fn() };
  mockNotifyValue = { addNotification: jest.fn() };
  mockDeriveNostr.mockReturnValue({ sk: new Uint8Array(32), pk: "pk-hex-aaaaaaaaaaaaaaaa" });
  mockLoadComments.mockReturnValue([]);
  mockSendComment.mockClear();
  mockSaveComment.mockClear();
  mockLoadComments.mockClear();
  mockClearOldComments.mockClear();
  mockFetchAgentProfile.mockClear().mockResolvedValue(null);
  mockGetCachedAgentProfile.mockClear().mockReturnValue(null);
  mockSyncLinkedAccountToIC.mockClear();
  mockCreateBackendActor.mockClear();
  mockCreateLedgerActor.mockClear();
});

afterEach(() => cleanup());

describe("AgentProvider — initial state", () => {
  it("provides default state when unauthenticated", () => {
    const { result } = renderHook(() => useAgent(), { wrapper });
    expect(result.current.agentState.isActive).toBe(false);
    expect(result.current.agentState.peers).toEqual([]);
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.wotGraph).toBeNull();
    expect(result.current.agentProfile).toBeNull();
    expect(result.current.nostrKeys).toBeNull();
    expect(result.current.d2aComments).toEqual([]);
  });

  it("clears old comments and loads existing on mount", () => {
    mockLoadComments.mockReturnValueOnce([{ id: "c1", contentHash: "h", senderPk: "s", comment: "hi", timestamp: 1, direction: "received" }]);
    const { result } = renderHook(() => useAgent(), { wrapper });
    expect(mockClearOldComments).toHaveBeenCalled();
    expect(result.current.d2aComments).toHaveLength(1);
  });
});

describe("AgentProvider — nostr key derivation", () => {
  it("derives nostr keypair when authenticated with principalText", () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const { result } = renderHook(() => useAgent(), { wrapper });
    expect(mockDeriveNostr).toHaveBeenCalledWith("principal-abc");
    expect(result.current.nostrKeys).not.toBeNull();
    expect(result.current.nostrKeys?.pk).toBe("pk-hex-aaaaaaaaaaaaaaaa");
  });

  it("nostrKeys is null without principalText", () => {
    const { result } = renderHook(() => useAgent(), { wrapper });
    expect(result.current.nostrKeys).toBeNull();
  });
});

describe("AgentProvider — refreshAgentProfile", () => {
  it("uses cached profile first, then fetches fresh and caches it", async () => {
    const cached = { name: "cached agent" };
    const fresh = { name: "fresh agent" };
    mockGetCachedAgentProfile.mockReturnValueOnce(cached);
    mockFetchAgentProfile.mockResolvedValueOnce(fresh);
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };

    const { result } = renderHook(() => useAgent(), { wrapper });
    await waitFor(() => expect(result.current.agentProfile).not.toBeNull());
    expect(result.current.agentProfile).toEqual(fresh);
    expect(mockSetCachedAgentProfile).toHaveBeenCalledWith("principal-abc", fresh);
  });

  it("noop when no nostrKeys (unauthenticated)", async () => {
    const { result } = renderHook(() => useAgent(), { wrapper });
    await act(async () => {
      await result.current.refreshAgentProfile();
    });
    expect(mockFetchAgentProfile).not.toHaveBeenCalled();
  });

  it("clears profile when authentication is lost", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    mockFetchAgentProfile.mockResolvedValueOnce({ name: "agent" });
    const { result, rerender } = renderHook(() => useAgent(), { wrapper });
    await waitFor(() => expect(result.current.agentProfile).not.toBeNull());

    mockAuthValue = { isAuthenticated: false, identity: null, principalText: "" };
    rerender();
    await waitFor(() => expect(result.current.agentProfile).toBeNull());
  });
});

describe("AgentProvider — toggleAgent", () => {
  it("toggles isEnabled and syncs linked account to IC when identity present", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const { result } = renderHook(() => useAgent(), { wrapper });
    expect(result.current.isEnabled).toBe(false);

    await act(async () => {
      result.current.toggleAgent();
    });
    expect(result.current.isEnabled).toBe(true);
    await waitFor(() => expect(mockSyncLinkedAccountToIC).toHaveBeenCalled());
    expect(mockSyncLinkedAccountToIC.mock.calls[0][2]).toBe(true);

    await act(async () => {
      result.current.toggleAgent();
    });
    expect(result.current.isEnabled).toBe(false);
  });

  it("toggleAgent without identity does not sync to IC", () => {
    const { result } = renderHook(() => useAgent(), { wrapper });
    act(() => {
      result.current.toggleAgent();
    });
    expect(mockSyncLinkedAccountToIC).not.toHaveBeenCalled();
    expect(result.current.isEnabled).toBe(true);
  });
});

describe("AgentProvider — manager lifecycle", () => {
  it("does NOT start manager when isEnabled=false", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    renderHook(() => useAgent(), { wrapper });
    await new Promise(r => setTimeout(r, 30));
    expect(managerInstances.length).toBe(0);
  });

  it("starts manager when authenticated AND enabled, stops on disable", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const { result } = renderHook(() => useAgent(), { wrapper });

    await act(async () => {
      result.current.toggleAgent();
    });
    await waitFor(() => expect(managerInstances.length).toBe(1));
    expect(managerInstances[0].start).toHaveBeenCalled();
    expect(managerInstances[0].principalText).toBe("principal-abc");

    await act(async () => {
      result.current.toggleAgent();
    });
    await waitFor(() => expect(managerInstances[0].stop).toHaveBeenCalled());
  });

  it("manager.callbacks.onNewContent forwards to ContentContext.addContent", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const { result } = renderHook(() => useAgent(), { wrapper });

    await act(async () => {
      result.current.toggleAgent();
    });
    await waitFor(() => expect(managerInstances.length).toBe(1));

    const fakeItem = { id: "x" };
    managerInstances[0].callbacks.onNewContent(fakeItem);
    expect(mockContentValue.addContent).toHaveBeenCalledWith(fakeItem);
  });

  it("manager.callbacks.onComment saves to storage and shows notification", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const { result } = renderHook(() => useAgent(), { wrapper });

    await act(async () => {
      result.current.toggleAgent();
    });
    await waitFor(() => expect(managerInstances.length).toBe(1));

    const msg = {
      payload: {
        contentHash: "hash-1",
        contentTitle: "An interesting article",
        comment: "Nice find",
        timestamp: 1234,
      },
    };
    act(() => {
      managerInstances[0].callbacks.onComment(msg, "sender-pk-1234567890");
    });
    expect(mockSaveComment).toHaveBeenCalledWith(expect.objectContaining({
      contentHash: "hash-1",
      senderPk: "sender-pk-1234567890",
      direction: "received",
    }));
    expect(mockNotifyValue.addNotification).toHaveBeenCalledWith(
      expect.stringMatching(/Comment from/),
      "info",
    );
  });
});

describe("AgentProvider — sendComment", () => {
  it("sends via handshake, saves comment, refreshes d2aComments", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const stored = { id: "c1", contentHash: "h", senderPk: "s", comment: "hi", timestamp: 1, direction: "sent" };
    mockLoadComments.mockReturnValueOnce([]).mockReturnValue([stored]);

    const { result } = renderHook(() => useAgent(), { wrapper });

    await act(async () => {
      await result.current.sendComment("peer-pk", {
        contentHash: "h",
        contentTitle: "title",
        comment: "hi",
        timestamp: 1,
      });
    });
    expect(mockSendComment).toHaveBeenCalled();
    expect(mockSaveComment).toHaveBeenCalled();
    expect(result.current.d2aComments).toEqual([stored]);
  });

  it("throws when no nostrKeys", async () => {
    const { result } = renderHook(() => useAgent(), { wrapper });
    await expect(
      result.current.sendComment("peer-pk", {
        contentHash: "h",
        contentTitle: "t",
        comment: "c",
        timestamp: 1,
      }),
    ).rejects.toThrow(/No Nostr keys/);
  });
});

describe("AgentProvider — setWoTGraph", () => {
  it("sets graph state and forwards to manager when present", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const { result } = renderHook(() => useAgent(), { wrapper });

    await act(async () => {
      result.current.toggleAgent();
    });
    await waitFor(() => expect(managerInstances.length).toBe(1));

    const graph = { userPubkey: "pk", nodes: new Map(), maxHops: 3, builtAt: 1 };
    act(() => {
      result.current.setWoTGraph(graph as never);
    });
    expect(result.current.wotGraph).toBe(graph);
    expect(managerInstances[0].setWoTGraph).toHaveBeenCalledWith(graph);
  });
});

describe("AgentProvider — agent state notifications", () => {
  it("notifies on receivedItems delta", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const { result } = renderHook(() => useAgent(), { wrapper });

    await act(async () => {
      result.current.toggleAgent();
    });
    await waitFor(() => expect(managerInstances.length).toBe(1));

    const onStateChange = managerInstances[0].callbacks.onStateChange;
    act(() => {
      onStateChange({
        isActive: true,
        myPubkey: "pk",
        peers: [],
        activeHandshakes: [],
        receivedItems: 0,
        sentItems: 0,
        d2aMatchCount: 0,
        consecutiveErrors: 0,
        activityLog: [],
      });
    });
    mockNotifyValue.addNotification.mockClear();
    act(() => {
      onStateChange({
        isActive: true,
        myPubkey: "pk",
        peers: [],
        activeHandshakes: [],
        receivedItems: 3,
        sentItems: 0,
        d2aMatchCount: 0,
        consecutiveErrors: 0,
        activityLog: [],
      });
    });
    expect(mockNotifyValue.addNotification).toHaveBeenCalledWith(
      expect.stringMatching(/Received 3 items/),
      "success",
    );
  });

  it("notifies on d2aMatchCount delta", async () => {
    mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
    const { result } = renderHook(() => useAgent(), { wrapper });
    await act(async () => {
      result.current.toggleAgent();
    });
    await waitFor(() => expect(managerInstances.length).toBe(1));

    const onStateChange = managerInstances[0].callbacks.onStateChange;
    act(() => {
      onStateChange({
        isActive: true, myPubkey: "pk", peers: [], activeHandshakes: [],
        receivedItems: 0, sentItems: 0, d2aMatchCount: 0, consecutiveErrors: 0, activityLog: [],
      });
    });
    mockNotifyValue.addNotification.mockClear();
    act(() => {
      onStateChange({
        isActive: true, myPubkey: "pk", peers: [], activeHandshakes: [],
        receivedItems: 0, sentItems: 0, d2aMatchCount: 1, consecutiveErrors: 0, activityLog: [],
      });
    });
    expect(mockNotifyValue.addNotification).toHaveBeenCalledWith(
      "D2A fee-paid match completed",
      "success",
    );
  });
});
