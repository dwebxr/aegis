// Only @dfinity/agent is mocked (no actual IC connection).
// Previous version was a LARP: mocked @/lib/ic/agent entirely,
// then asserted on mock call counts — tested the mock, not the code.

const mockSyncTime = jest.fn().mockResolvedValue(undefined);
const mockFetchRootKey = jest.fn().mockResolvedValue(undefined);
const mockCreateSync = jest.fn().mockReturnValue({
  syncTime: mockSyncTime,
  fetchRootKey: mockFetchRootKey,
});
const mockActorCreateActor = jest.fn().mockReturnValue({ icrc1_balance_of: jest.fn() });

// Mock ONLY the external library — let project code (agent.ts, config.ts) run for real
jest.mock("@dfinity/agent", () => ({
  HttpAgent: { createSync: (...args: unknown[]) => mockCreateSync(...args) },
  Actor: { createActor: (...args: unknown[]) => mockActorCreateActor(...args) },
}));

import { createICPLedgerActorAsync } from "@/lib/ic/icpLedger";

beforeEach(() => jest.clearAllMocks());

describe("createICPLedgerActorAsync", () => {
  const mockIdentity = {} as import("@dfinity/agent").Identity;

  it("creates an actor with the real ICP ledger canister ID", async () => {
    const actor = await createICPLedgerActorAsync(mockIdentity);

    // Real createAgent runs → HttpAgent.createSync called with real host + identity
    expect(mockCreateSync).toHaveBeenCalledTimes(1);
    const [agentOpts] = mockCreateSync.mock.calls[0];
    expect(agentOpts.host).toMatch(/^https?:\/\//);
    expect(agentOpts.identity).toBe(mockIdentity);

    // Real Actor.createActor called with the inline IDL factory + ICP ledger canister ID
    expect(mockActorCreateActor).toHaveBeenCalledTimes(1);
    const [idlFactory, options] = mockActorCreateActor.mock.calls[0];
    expect(typeof idlFactory).toBe("function");
    expect(options.canisterId).toBe("ryjl3-tyaaa-aaaaa-aaaba-cai");
    expect(actor).toHaveProperty("icrc1_balance_of");
  });

  it("syncs time before creating actor", async () => {
    await createICPLedgerActorAsync(mockIdentity);
    expect(mockSyncTime).toHaveBeenCalledTimes(1);
  });

  it("isLocal is false in test env → no fetchRootKey call", async () => {
    await createICPLedgerActorAsync(mockIdentity);
    expect(mockFetchRootKey).not.toHaveBeenCalled();
  });

  it("continues even if syncTime fails (non-blocking)", async () => {
    mockSyncTime.mockRejectedValueOnce(new Error("Time sync failed"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation();

    const actor = await createICPLedgerActorAsync(mockIdentity);

    // syncTime failed but actor was still created
    expect(mockSyncTime).toHaveBeenCalledTimes(1);
    expect(mockActorCreateActor).toHaveBeenCalledTimes(1);
    expect(actor).toHaveProperty("icrc1_balance_of");

    // Error was logged with the real errMsg() utility
    expect(errorSpy).toHaveBeenCalledWith("[ic] ledger syncTime failed:", "Time sync failed");
    errorSpy.mockRestore();
  });

  it("passes the IDL factory that defines ICRC-1/2 methods", async () => {
    await createICPLedgerActorAsync(mockIdentity);

    const [idlFactory] = mockActorCreateActor.mock.calls[0];
    // Call the IDL factory with a mock IDL to verify structure
    const mockIDL = {
      Record: jest.fn().mockReturnValue("Record"),
      Opt: jest.fn().mockReturnValue("Opt"),
      Vec: jest.fn().mockReturnValue("Vec"),
      Nat: "Nat",
      Nat8: "Nat8",
      Nat64: "Nat64",
      Text: "Text",
      Null: "Null",
      Principal: "Principal",
      Variant: jest.fn().mockReturnValue("Variant"),
      Func: jest.fn().mockReturnValue("Func"),
      Service: jest.fn().mockReturnValue("Service"),
    };

    idlFactory({ IDL: mockIDL });
    expect(mockIDL.Service).toHaveBeenCalledTimes(1);
    const serviceDef = mockIDL.Service.mock.calls[0][0];
    // Verify all 5 ICRC-1/2 methods are defined
    expect(serviceDef).toHaveProperty("icrc1_balance_of");
    expect(serviceDef).toHaveProperty("icrc1_fee");
    expect(serviceDef).toHaveProperty("icrc1_transfer");
    expect(serviceDef).toHaveProperty("icrc2_approve");
    expect(serviceDef).toHaveProperty("icrc2_allowance");
  });
});
