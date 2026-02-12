const mockCreateActor = jest.fn();
const mockSyncTime = jest.fn();

jest.mock("@dfinity/agent", () => ({
  Actor: {
    createActor: (...args: unknown[]) => mockCreateActor(...args),
  },
}));

jest.mock("@/lib/ic/agent", () => ({
  createAgent: () => ({
    syncTime: () => mockSyncTime(),
  }),
  ensureRootKey: jest.fn().mockResolvedValue(undefined),
}));

import { createICPLedgerActorAsync } from "@/lib/ic/icpLedger";

describe("createICPLedgerActorAsync", () => {
  const mockIdentity = {} as import("@dfinity/agent").Identity;

  beforeEach(() => {
    mockCreateActor.mockReset();
    mockSyncTime.mockReset();
  });

  it("creates an actor with the ICP ledger canister ID", async () => {
    mockSyncTime.mockResolvedValueOnce(undefined);
    const fakeActor = { icrc1_balance_of: jest.fn() };
    mockCreateActor.mockReturnValueOnce(fakeActor);

    const actor = await createICPLedgerActorAsync(mockIdentity);
    expect(actor).toBe(fakeActor);
    expect(mockCreateActor).toHaveBeenCalledTimes(1);

    const [idlFactory, options] = mockCreateActor.mock.calls[0];
    expect(typeof idlFactory).toBe("function");
    expect(options.canisterId).toBe("ryjl3-tyaaa-aaaaa-aaaba-cai");
  });

  it("syncs time before creating actor", async () => {
    mockSyncTime.mockResolvedValueOnce(undefined);
    mockCreateActor.mockReturnValueOnce({});

    await createICPLedgerActorAsync(mockIdentity);
    expect(mockSyncTime).toHaveBeenCalledTimes(1);
  });

  it("continues even if syncTime fails (non-blocking)", async () => {
    mockSyncTime.mockRejectedValueOnce(new Error("Time sync failed"));
    const fakeActor = { icrc1_fee: jest.fn() };
    mockCreateActor.mockReturnValueOnce(fakeActor);

    // Should NOT throw — syncTime failure is logged but non-fatal
    const actor = await createICPLedgerActorAsync(mockIdentity);
    expect(actor).toBe(fakeActor);
    expect(mockCreateActor).toHaveBeenCalledTimes(1);
  });

  it("passes the IDL factory that defines ICRC-1/2 methods", async () => {
    mockSyncTime.mockResolvedValueOnce(undefined);
    mockCreateActor.mockReturnValueOnce({});

    await createICPLedgerActorAsync(mockIdentity);

    const [idlFactory] = mockCreateActor.mock.calls[0];
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

    const service = idlFactory({ IDL: mockIDL });
    expect(mockIDL.Service).toHaveBeenCalledTimes(1);
    const serviceDef = mockIDL.Service.mock.calls[0][0];
    // Verify all 5 methods are defined
    expect(serviceDef).toHaveProperty("icrc1_balance_of");
    expect(serviceDef).toHaveProperty("icrc1_fee");
    expect(serviceDef).toHaveProperty("icrc1_transfer");
    expect(serviceDef).toHaveProperty("icrc2_approve");
    expect(serviceDef).toHaveProperty("icrc2_allowance");
  });
});
