const mockReconcileKV = {
  set: jest.fn(),
  zadd: jest.fn(),
  zrange: jest.fn(),
};

jest.mock("@/lib/api/kv/internal/factory", () => ({
  kvNamespace: jest.fn(() => mockReconcileKV),
}));

import { writeResolution } from "@/lib/api/kv/reconcileJournal";

const HASH = "a".repeat(64);
const TOKEN = "resolution-token";
const KEY = `${HASH}:resolution:${TOKEN}`;
const RESOLUTION = { epoch: 7, outcome: "needs-review" };

describe("reconcileJournal resolution indexing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReconcileKV.zadd.mockResolvedValue(1);
    mockReconcileKV.set.mockResolvedValue("OK");
    mockReconcileKV.zrange.mockResolvedValue([KEY]);
  });

  it("writes the resolution index before the append-only record", async () => {
    const beforeWrite = jest.fn().mockResolvedValue(undefined);

    await expect(writeResolution(HASH, TOKEN, RESOLUTION, beforeWrite)).resolves.toBe(true);

    expect(mockReconcileKV.zadd).toHaveBeenCalledWith(
      "resolution-index",
      { score: 7, member: KEY },
    );
    expect(mockReconcileKV.zadd.mock.invocationCallOrder[0])
      .toBeLessThan(mockReconcileKV.set.mock.invocationCallOrder[0]);
    expect(beforeWrite).toHaveBeenCalledTimes(2);
  });

  it("does not create a durable record when the preceding index write fails", async () => {
    mockReconcileKV.zadd.mockResolvedValueOnce(undefined);
    const beforeWrite = jest.fn().mockResolvedValue(undefined);

    await expect(writeResolution(HASH, TOKEN, RESOLUTION, beforeWrite))
      .rejects.toThrow("Resolution index could not be written before its record");

    expect(mockReconcileKV.set).not.toHaveBeenCalled();
  });

  it("leaves only a discoverable dangling index when the later record write fails", async () => {
    mockReconcileKV.set.mockRejectedValueOnce(new Error("record write failed"));
    const beforeWrite = jest.fn().mockResolvedValue(undefined);

    await expect(writeResolution(HASH, TOKEN, RESOLUTION, beforeWrite))
      .rejects.toThrow("record write failed");

    expect(mockReconcileKV.zadd).toHaveBeenCalledTimes(1);
    expect(mockReconcileKV.zadd.mock.invocationCallOrder[0])
      .toBeLessThan(mockReconcileKV.set.mock.invocationCallOrder[0]);
  });

  it("repairs a missing index when an idempotent SET NX finds an existing record", async () => {
    mockReconcileKV.set.mockResolvedValueOnce(null);
    mockReconcileKV.zrange.mockResolvedValueOnce([]);
    const beforeWrite = jest.fn().mockResolvedValue(undefined);

    await expect(writeResolution(HASH, TOKEN, RESOLUTION, beforeWrite)).resolves.toBe(false);

    expect(mockReconcileKV.zrange).toHaveBeenCalledWith("resolution-index", 0, -1);
    expect(mockReconcileKV.zadd).toHaveBeenCalledTimes(2);
    expect(mockReconcileKV.zadd).toHaveBeenLastCalledWith(
      "resolution-index",
      { score: 7, member: KEY },
    );
    expect(beforeWrite).toHaveBeenCalledTimes(3);
  });
});
