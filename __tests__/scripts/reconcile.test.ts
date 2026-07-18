const mockAcquireRunbookLock = jest.fn();
const mockAssertCompensationTombstonesPermanent = jest.fn();
const mockIncrementRunbookEpoch = jest.fn();
const mockListResolutions = jest.fn();
const mockListStalePending = jest.fn();
const mockPruneMissingPending = jest.fn();
const mockReadReconcileCandidate = jest.fn();
const mockReadRunbookEpoch = jest.fn();
const mockReadRunbookLock = jest.fn();
const mockReleaseRunbookLock = jest.fn();
const mockVerifySettlement = jest.fn();

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
  releaseRunbookLock: mockReleaseRunbookLock,
  writeCompensationTombstone: jest.fn(),
  writeResolution: jest.fn(),
}));

jest.mock("@/scripts/verify-settlement", () => ({
  ...jest.requireActual("@/scripts/verify-settlement"),
  verifySettlement: (...args: unknown[]) => mockVerifySettlement(...args),
}));

import {
  buildJournalVerificationPlan,
  resolutionWarnings,
  runReconcileReport,
  verifyJournalSettlement,
} from "@/scripts/reconcile";
import type { SettlementAttempt } from "@/lib/d2a/settlementJournal";
import {
  BASE_USDC_IMPLEMENTATION,
  BASE_USDC_PROXY,
} from "@/scripts/verify-settlement";

const HASH = "a".repeat(64);
const NONCE = `0x${"ab".repeat(32)}`;
const AUTHORIZATION = {
  from: "0x0000000000000000000000000000000000000002",
  to: "0x0000000000000000000000000000000000000001",
  value: "20000",
  nonce: NONCE,
  validAfter: "0",
  validBefore: "1750000000",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

function journalAttempt(
  authorization: SettlementAttempt["authorization"] = AUTHORIZATION,
): SettlementAttempt {
  return {
    status: "unknown",
    network: authorization.network,
    asset: authorization.asset,
    amount: "999",
    payTo: "0xlegacy-payee-must-not-be-used",
    payer: "0xlegacy-payer-must-not-be-used",
    url: "https://example.com/article",
    price: "20000",
    authorization,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
  };
}

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
    mockVerifySettlement.mockResolvedValue({
      status: "closed-unpaid",
      evidence: { compensationAllowed: true, reason: "test" },
    });
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

  it("builds chain and verifier input only from the journal authorization", () => {
    const plan = buildJournalVerificationPlan(journalAttempt(), {
      tx: `0x${"cd".repeat(32)}`,
      payer: AUTHORIZATION.from.toUpperCase().replace("0X", "0x"),
      nonce: AUTHORIZATION.nonce.toUpperCase().replace("0X", "0x"),
    });

    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") throw new Error(plan.reason);
    expect(plan.chain.id).toBe(84532);
    expect(plan.rpcUrl).toBe("https://sepolia.base.org");
    expect(plan.input).toEqual({
      txHash: `0x${"cd".repeat(32)}`,
      payer: AUTHORIZATION.from,
      payTo: AUTHORIZATION.to,
      amount: 20_000n,
      nonce: AUTHORIZATION.nonce,
      validBefore: 1_750_000_000n,
      network: "eip155:84532",
      usdc: AUTHORIZATION.asset,
      expectedImplementation: "0xd74cc5d436923b8ba2c179b4bCA2841D8A52C5B5",
    });
  });

  it("passes the journal-derived authorization and network to verifySettlement", async () => {
    const result = await verifyJournalSettlement(journalAttempt(), {
      tx: `0x${"cd".repeat(32)}`,
      payer: AUTHORIZATION.from,
      nonce: AUTHORIZATION.nonce,
    });

    expect(result.status).toBe("closed-unpaid");
    expect(mockVerifySettlement).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        payer: AUTHORIZATION.from,
        payTo: AUTHORIZATION.to,
        amount: 20_000n,
        nonce: AUTHORIZATION.nonce,
        validBefore: 1_750_000_000n,
        network: "eip155:84532",
        usdc: AUTHORIZATION.asset,
      }),
    );
  });

  it("selects Base mainnet RPC, USDC, and implementation pin from attempt.network", () => {
    const authorization = {
      ...AUTHORIZATION,
      network: "eip155:8453",
      asset: BASE_USDC_PROXY,
    };
    const plan = buildJournalVerificationPlan(journalAttempt(authorization));

    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") throw new Error(plan.reason);
    expect(plan.chain.id).toBe(8453);
    expect(plan.rpcUrl).toBe("https://mainnet.base.org");
    expect(plan.input).toEqual(expect.objectContaining({
      network: "eip155:8453",
      usdc: BASE_USDC_PROXY,
      expectedImplementation: BASE_USDC_IMPLEMENTATION,
    }));
  });

  it("rejects CLI authorization values that disagree with the journal", () => {
    expect(() => buildJournalVerificationPlan(journalAttempt(), {
      nonce: `0x${"ef".repeat(32)}`,
    })).toThrow("--nonce does not match the journal authorization");
    expect(() => buildJournalVerificationPlan(journalAttempt(), {
      "valid-before": "1750000001",
    })).toThrow("--valid-before does not match the journal authorization");
  });

  it("classifies an unknown journal network as needs-review", () => {
    const plan = buildJournalVerificationPlan(journalAttempt({
      ...AUTHORIZATION,
      network: "eip155:999999",
    }));
    expect(plan).toEqual({
      status: "needs-review",
      reason: "journal-network-unsupported:eip155:999999",
    });
  });
});
