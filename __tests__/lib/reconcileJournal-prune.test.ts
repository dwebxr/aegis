const mockReconcileKV = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  zrange: jest.fn(),
  mget: jest.fn(),
  zrem: jest.fn(),
};

jest.mock("@/lib/api/kv/internal/factory", () => ({
  kvNamespace: jest.fn(() => mockReconcileKV),
}));

import {
  acquireRunbookLock,
  pruneMissingPending,
  releaseRunbookLock,
} from "@/lib/api/kv/reconcileJournal";

describe("reconcileJournal pending-index pruning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReconcileKV.zrange.mockResolvedValue([]);
    mockReconcileKV.mget.mockResolvedValue([]);
    mockReconcileKV.zrem.mockResolvedValue(0);
    mockReconcileKV.get.mockResolvedValue(null);
    mockReconcileKV.set.mockResolvedValue("OK");
    mockReconcileKV.del.mockResolvedValue(1);
  });

  it("MGETs records older than retention and removes only missing members", async () => {
    const missing = `${"a".repeat(64)}:a:missing`;
    const retained = `${"b".repeat(64)}:a:retained`;
    mockReconcileKV.zrange.mockResolvedValueOnce([missing, retained]);
    mockReconcileKV.mget.mockResolvedValueOnce([null, { status: "pending" }]);
    mockReconcileKV.zrem.mockResolvedValueOnce(1);
    const beforeWrite = jest.fn().mockResolvedValue(undefined);

    await expect(pruneMissingPending(123, beforeWrite)).resolves.toEqual({
      checked: 2,
      pruned: 1,
    });
    expect(mockReconcileKV.zrange).toHaveBeenCalledWith(
      "pending",
      "-inf",
      123,
      { byScore: true },
    );
    expect(mockReconcileKV.mget).toHaveBeenCalledWith(missing, retained);
    expect(beforeWrite).toHaveBeenCalledTimes(1);
    expect(mockReconcileKV.zrem).toHaveBeenCalledWith("pending", missing);
  });

  it("does not write when every old member still has a record", async () => {
    const retained = `${"b".repeat(64)}:a:retained`;
    mockReconcileKV.zrange.mockResolvedValueOnce([retained]);
    mockReconcileKV.mget.mockResolvedValueOnce([{ status: "rejected" }]);
    const beforeWrite = jest.fn();

    await expect(pruneMissingPending(123, beforeWrite)).resolves.toEqual({
      checked: 1,
      pruned: 0,
    });
    expect(beforeWrite).not.toHaveBeenCalled();
    expect(mockReconcileKV.zrem).not.toHaveBeenCalled();
  });

  it("releases a normally completed run so the lock can be reacquired immediately", async () => {
    let owner: string | null = null;
    mockReconcileKV.set.mockImplementation(async (_key, value, options) => {
      if (options?.nx && owner !== null) return null;
      owner = String(value);
      return "OK";
    });
    mockReconcileKV.get.mockImplementation(async () => owner);
    mockReconcileKV.del.mockImplementation(async () => {
      owner = null;
      return 1;
    });

    await expect(acquireRunbookLock("first-owner")).resolves.toBe(true);
    await expect(releaseRunbookLock("first-owner")).resolves.toBe(true);
    await expect(acquireRunbookLock("next-owner")).resolves.toBe(true);
  });

  it("does not delete a runbook lock owned by another token", async () => {
    mockReconcileKV.get.mockResolvedValue("current-owner");

    await expect(releaseRunbookLock("stale-owner")).resolves.toBe(false);
    expect(mockReconcileKV.del).not.toHaveBeenCalled();
  });
});
