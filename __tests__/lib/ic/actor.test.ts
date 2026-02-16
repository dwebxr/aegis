const mockSyncTime = jest.fn();
const mockCreateActor = jest.fn().mockReturnValue({});

jest.mock("@dfinity/agent", () => ({
  Actor: { createActor: (...args: unknown[]) => mockCreateActor(...args) },
}));

jest.mock("@/lib/ic/agent", () => ({
  createAgent: jest.fn().mockReturnValue({
    syncTime: (...args: unknown[]) => mockSyncTime(...args),
  }),
  ensureRootKey: jest.fn().mockResolvedValue(undefined),
  getCanisterId: jest.fn().mockReturnValue("test-canister-id"),
}));

jest.mock("@/lib/ic/declarations", () => ({
  idlFactory: jest.fn(),
}));

import { createBackendActorAsync, createBackendActor } from "@/lib/ic/actor";

describe("createBackendActor", () => {
  it("creates actor synchronously with correct canisterId", () => {
    const actor = createBackendActor();
    expect(mockCreateActor).toHaveBeenCalledTimes(1);
    const [, opts] = mockCreateActor.mock.calls[0];
    expect(opts.canisterId).toBe("test-canister-id");
    expect(actor).toBeDefined();
  });
});

describe("createBackendActorAsync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateActor.mockReturnValue({ mock: "actor" });
  });

  it("returns actor after successful syncTime", async () => {
    mockSyncTime.mockResolvedValueOnce(undefined);

    const actor = await createBackendActorAsync();

    expect(mockSyncTime).toHaveBeenCalledTimes(1);
    expect(mockCreateActor).toHaveBeenCalledTimes(1);
    expect(actor).toEqual({ mock: "actor" });
  });

  it("returns actor even when syncTime throws (clock drift tolerance)", async () => {
    mockSyncTime.mockRejectedValueOnce(new Error("Network unreachable"));

    const errorSpy = jest.spyOn(console, "error").mockImplementation();

    const actor = await createBackendActorAsync();

    expect(mockSyncTime).toHaveBeenCalledTimes(1);
    expect(mockCreateActor).toHaveBeenCalledTimes(1);
    expect(actor).toEqual({ mock: "actor" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[ic] syncTime failed:",
      "Network unreachable"
    );

    errorSpy.mockRestore();
  });

  it("does not call createActor twice on syncTime failure", async () => {
    mockSyncTime.mockRejectedValueOnce(new Error("Timeout"));
    jest.spyOn(console, "error").mockImplementation();

    await createBackendActorAsync();

    expect(mockCreateActor).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
  });
});
