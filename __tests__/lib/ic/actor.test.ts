/**
 * Tests for IC actor creation — exercises real actor.ts + agent.ts code.
 * Only the external @dfinity/agent library is mocked (no actual IC connection).
 * Previous version was a LARP: mocked @/lib/ic/agent and @/lib/ic/declarations
 * entirely, then asserted on mock call counts — tested the mock, not the code.
 */

const mockSyncTime = jest.fn().mockResolvedValue(undefined);
const mockFetchRootKey = jest.fn().mockResolvedValue(undefined);
const mockCreateSync = jest.fn().mockReturnValue({
  syncTime: mockSyncTime,
  fetchRootKey: mockFetchRootKey,
});
const mockActorCreateActor = jest.fn().mockReturnValue({ getUserEvaluations: jest.fn() });

// Mock ONLY the external library — let project code (agent.ts, config.ts, declarations/) run for real
jest.mock("@dfinity/agent", () => ({
  HttpAgent: { createSync: (...args: unknown[]) => mockCreateSync(...args) },
  Actor: { createActor: (...args: unknown[]) => mockActorCreateActor(...args) },
}));

import { createBackendActorAsync } from "@/lib/ic/actor";
import { idlFactory } from "@/lib/ic/declarations";

beforeEach(() => jest.clearAllMocks());

describe("createBackendActorAsync", () => {
  it("calls agent.syncTime() and creates actor on success", async () => {
    const actor = await createBackendActorAsync();

    // Real ensureRootKey runs (isLocal=false in test env → no fetchRootKey call)
    expect(mockFetchRootKey).not.toHaveBeenCalled();

    // Real syncTime was called on the agent
    expect(mockSyncTime).toHaveBeenCalledTimes(1);

    // Actor created with real factory + real canisterId
    const [passedFactory, actorOpts] = mockActorCreateActor.mock.calls[0];
    expect(passedFactory).toBe(idlFactory);
    expect(actorOpts.canisterId).toBe("rluf3-eiaaa-aaaam-qgjuq-cai");
    expect(actor).toBeDefined();
  });

  it("still creates actor when syncTime fails (clock drift tolerance)", async () => {
    mockSyncTime.mockRejectedValueOnce(new Error("Network unreachable"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation();

    const actor = await createBackendActorAsync();

    // syncTime failed but actor was still created
    expect(mockSyncTime).toHaveBeenCalledTimes(1);
    expect(mockActorCreateActor).toHaveBeenCalledTimes(1);
    expect(actor).toBeDefined();

    // Error was logged with the real errMsg() utility
    expect(errorSpy).toHaveBeenCalledWith("[ic] syncTime failed:", "Network unreachable");
    errorSpy.mockRestore();
  });

  it("agent receives the same host as sync version", async () => {
    await createBackendActorAsync();

    const [agentOpts] = mockCreateSync.mock.calls[0];
    expect(agentOpts.host).toMatch(/^https?:\/\//);
  });
});
