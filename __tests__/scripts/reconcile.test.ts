const mockAcquireRunbookLock = jest.fn();
const mockAssertCompensationTombstonesPermanent = jest.fn();
const mockIncrementRunbookEpoch = jest.fn();
const mockListResolutions = jest.fn();
const mockListStalePending = jest.fn();
const mockPruneMissingPending = jest.fn();
const mockReadReconcileCandidate = jest.fn();
const mockReadRunbookEpoch = jest.fn();
const mockReadRunbookLock = jest.fn();

jest.mock("@/lib/api/kv/reconcileJournal", () => ({
  acquireRunbookLock: mockAcquireRunbookLock,
  assertCompensationTombstonesPermanent: mockAssertCompensationTombstonesPermanent,
  incrementRunbookEpoch: mockIncrementRunbookEpoch,
  listResolutions: mockListResolutions,
  listStalePending: mockListStalePending,
  pruneMissingPending: mockPruneMissingPending,
  readReconcileCandidate: mockReadReconcileCandidate,
  readRunbookEpoch: mockReadRunbookEpoch,
  readRunbookLock: mockReadRunbookLock,
  writeCompensationTombstone: jest.fn(),
  writeResolution: jest.fn(),
}));

import { resolutionWarnings, runReconcileReport } from "@/scripts/reconcile";

const HASH = "a".repeat(64);

describe("reconcile report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(10_000_000);
    mockAcquireRunbookLock.mockResolvedValue(true);
    mockReadRunbookLock.mockResolvedValue("owner");
    mockIncrementRunbookEpoch.mockResolvedValue(7);
    mockAssertCompensationTombstonesPermanent.mockResolvedValue(2);
    mockListStalePending.mockResolvedValue([`${HASH}:a:attempt`]);
    mockPruneMissingPending.mockResolvedValue({ checked: 1, pruned: 1 });
    mockReadReconcileCandidate.mockResolvedValue({
      final: null,
      attempt: { status: "unknown", createdAt: 1_000_000 },
      attemptTtl: 7 * 24 * 60 * 60,
    });
    mockListResolutions.mockResolvedValue([
      {
        key: `${HASH}:resolution:r1`,
        hash: HASH,
        attemptToken: "attempt",
        epoch: 6,
        outcome: "needs-review",
        evidence: {},
        createdAt: 1,
      },
    ]);
    mockReadRunbookEpoch.mockResolvedValue(7);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("takes the lock, increments the epoch, asserts tombstone TTLs, and reports eligible items", async () => {
    const report = await runReconcileReport("owner");

    expect(mockAcquireRunbookLock).toHaveBeenCalledWith("owner");
    expect(mockReadRunbookLock.mock.invocationCallOrder[0])
      .toBeLessThan(mockIncrementRunbookEpoch.mock.invocationCallOrder[0]);
    expect(mockAssertCompensationTombstonesPermanent).toHaveBeenCalledTimes(1);
    expect(report.candidates[0]).toEqual(expect.objectContaining({
      eligible: true,
      status: "unknown",
      attemptTtl: 604_800,
    }));
    expect(report.prunedPendingCount).toBe(1);
    expect(mockPruneMissingPending).toHaveBeenCalledWith(
      10_000_000 - 90 * 24 * 60 * 60 * 1_000 - 1,
      expect.any(Function),
    );
    expect(report.resolutions).toHaveLength(1);
    expect(report.resolutionWarnings[0]).toEqual(expect.objectContaining({ stale: true }));
  });

  it.each(["settled", "rejected"])(
    "keeps dangling terminal status %s report-only with a cleanup warning",
    async (status) => {
      mockReadReconcileCandidate.mockResolvedValue({
        final: null,
        attempt: { status, createdAt: 1_000_000 },
        attemptTtl: 7 * 24 * 60 * 60,
      });

      const report = await runReconcileReport("owner");

      expect(report.candidates[0]).toEqual(expect.objectContaining({
        eligible: false,
        note: "terminal-status-dangling-index-cleanup-required",
      }));
    },
  );

  it("keeps near-expiry attempts report-only", async () => {
    mockReadReconcileCandidate.mockResolvedValue({
      final: null,
      attempt: { status: "pending", createdAt: 1_000_000 },
      attemptTtl: 604_799,
    });

    const report = await runReconcileReport("owner");

    expect(report.candidates[0]).toEqual(expect.objectContaining({
      eligible: false,
      note: "ttl-under-seven-days-report-only",
    }));
  });

  it("does not select a winner when resolutions conflict", () => {
    const records = [
      { key: "r2", hash: HASH, epoch: 2 },
      { key: "r1", hash: HASH, epoch: 1 },
    ] as never;

    expect(resolutionWarnings(records, 2)).toEqual([
      expect.objectContaining({
        hash: HASH,
        multiple: true,
        stale: true,
        resolutions: [
          expect.objectContaining({ key: "r1" }),
          expect.objectContaining({ key: "r2" }),
        ],
      }),
    ]);
  });
});
