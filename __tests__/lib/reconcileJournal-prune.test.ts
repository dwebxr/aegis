const mockReconcileKV = {
  zrange: jest.fn(),
  mget: jest.fn(),
  zrem: jest.fn(),
};

jest.mock("@/lib/api/kv/internal/factory", () => ({
  kvNamespace: jest.fn(() => mockReconcileKV),
}));

import { pruneMissingPending } from "@/lib/api/kv/reconcileJournal";

describe("reconcileJournal pending-index pruning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReconcileKV.zrange.mockResolvedValue([]);
    mockReconcileKV.mget.mockResolvedValue([]);
    mockReconcileKV.zrem.mockResolvedValue(0);
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
});
