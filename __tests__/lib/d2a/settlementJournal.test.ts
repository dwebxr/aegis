const mockJournal = {
  get: jest.fn(),
  set: jest.fn(),
  mget: jest.fn(),
  zadd: jest.fn(),
  zrem: jest.fn(),
};
const mockMetrics = {
  zadd: jest.fn(),
  zremrangebyrank: jest.fn(),
  incr: jest.fn(),
};
const mockCaptureException = jest.fn();

jest.mock("@/lib/api/kv/journalNamespace", () => ({ journalKV: mockJournal }));
jest.mock("@/lib/api/kv/namespace", () => ({ metricsKV: mockMetrics }));
jest.mock("@sentry/nextjs", () => ({ captureException: mockCaptureException }));

import type { SettleContext, SettleResultContext } from "@x402/core/server";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import {
  acquirePaymentWork,
  canonicalPaymentIdentity,
  createAttempt,
  onAfterSettle,
  onAfterVerify,
  onBeforeSettle,
  onSettleFailure,
  readFinalAndAttempt,
} from "@/lib/d2a/settlementJournal";

const AUTHORIZATION = {
  from: "0x0000000000000000000000000000000000000002",
  to: "0x0000000000000000000000000000000000000001",
  value: "20000",
  validAfter: "0",
  validBefore: "1750000000",
  nonce: `0x${"ab".repeat(32)}`,
};

function context(): SettleContext {
  return {
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:84532",
        asset: "0xasset",
        amount: "20000",
        payTo: "0xreceiver",
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: { authorization: AUTHORIZATION, signature: "0xfake" },
      resource: { url: "https://example.com/article?x=1" },
    },
    requirements: {
      scheme: "exact",
      network: "eip155:84532",
      asset: "0xasset",
      amount: "20000",
      payTo: "0xreceiver",
      maxTimeoutSeconds: 300,
      extra: {},
    },
    declaredExtensions: {},
    transportContext: {},
  } as unknown as SettleContext;
}

describe("settlementJournal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJournal.get.mockResolvedValue(null);
    mockJournal.set.mockResolvedValue("OK");
    mockJournal.mget.mockResolvedValue([null]);
    mockJournal.zadd.mockResolvedValue(1);
    mockJournal.zrem.mockResolvedValue(1);
    mockMetrics.zadd.mockResolvedValue(1);
    mockMetrics.zremrangebyrank.mockResolvedValue(0);
    mockMetrics.incr.mockResolvedValue(1);
  });

  it("maps equivalent JSON order, whitespace, and base64 padding to one identity", () => {
    const payment = context().paymentPayload;
    const reordered = {
      payload: {
        signature: "0xfake",
        authorization: {
          nonce: AUTHORIZATION.nonce.toUpperCase().replace("0X", "0x"),
          validBefore: AUTHORIZATION.validBefore,
          validAfter: AUTHORIZATION.validAfter,
          value: AUTHORIZATION.value,
          to: AUTHORIZATION.to,
          from: AUTHORIZATION.from.toUpperCase().replace("0X", "0x"),
        },
      },
      accepted: payment.accepted,
      x402Version: 2,
      resource: payment.resource,
    };
    const compact = Buffer.from(JSON.stringify(payment), "utf8").toString("base64");
    const spacedUnpadded = Buffer.from(JSON.stringify(reordered, null, 2), "utf8")
      .toString("base64")
      .replace(/=+$/, "");

    const first = canonicalPaymentIdentity(decodePaymentSignatureHeader(compact));
    const second = canonicalPaymentIdentity(decodePaymentSignatureHeader(spacedUnpadded));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("acquires paid work with a 150-second SET NX marker that has no release API", async () => {
    await expect(acquirePaymentWork("payment-hash")).resolves.toBe(true);
    expect(mockJournal.set).toHaveBeenCalledWith(
      "payment-hash:work",
      "reserved",
      { nx: true, ex: 150 },
    );

    mockJournal.set.mockResolvedValueOnce(null);
    await expect(acquirePaymentWork("payment-hash")).resolves.toBe(false);
  });

  it("counts every verify shape except literal boolean true as verify-failure", async () => {
    for (const result of [
      { isValid: false },
      {},
      null,
      { isValid: "true" },
    ]) {
      await onAfterVerify({ ...context(), result } as never);
    }
    expect(mockMetrics.zadd).toHaveBeenCalledTimes(4);
    expect(mockMetrics.zadd).toHaveBeenCalledWith(
      "settle:eip155:84532",
      expect.objectContaining({ member: expect.stringContaining(":verify-failure:") }),
    );

    mockMetrics.zadd.mockClear();
    await onAfterVerify({ ...context(), result: { isValid: true } } as never);
    expect(mockMetrics.zadd).not.toHaveBeenCalled();
  });

  it("retries SET NX attempt-token collisions up to three times", async () => {
    mockJournal.set
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("OK");

    const result = await createAttempt("hash", () => ({
      status: "pending",
      network: "eip155:84532",
      asset: "asset",
      amount: "1",
      payTo: "payTo",
      payer: "payer",
      url: "https://example.com",
      price: "1",
      authorization: {
        ...AUTHORIZATION,
        network: "eip155:84532",
        asset: "asset",
      },
      createdAt: 1,
      updatedAt: 1,
    }));

    expect(result).not.toBeNull();
    expect(mockJournal.set).toHaveBeenCalledTimes(3);
    for (const call of mockJournal.set.mock.calls) {
      expect(call[2]).toEqual({ nx: true, ex: 7_776_000 });
    }
  });

  it("uses MGET and treats final as absorbing regardless of attempt state", async () => {
    const final = { attemptToken: "winner", txHash: "0xtx", settledAt: 10 };
    mockJournal.mget.mockResolvedValueOnce([
      final,
      { status: "unknown", updatedAt: 9 },
    ]);

    await expect(readFinalAndAttempt("hash", "attempt")).resolves.toEqual({
      final,
      attempt: expect.objectContaining({ status: "unknown" }),
    });
    expect(mockJournal.mget).toHaveBeenCalledWith("hash:final", "hash:a:attempt");
    expect(mockJournal.get).not.toHaveBeenCalled();
  });

  it("falls back in final → attempt → final order when MGET is unavailable", async () => {
    mockJournal.mget.mockResolvedValueOnce(undefined);
    mockJournal.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "unknown" })
      .mockResolvedValueOnce({ attemptToken: "winner", txHash: "0xtx", settledAt: 10 });

    const result = await readFinalAndAttempt("hash", "attempt");
    expect(result.final?.attemptToken).toBe("winner");
    expect(mockJournal.get.mock.calls.map((call) => call[0])).toEqual([
      "hash:final",
      "hash:a:attempt",
      "hash:final",
    ]);
  });

  it("checks final before unknown and compensation before acquiring a claim", async () => {
    mockJournal.get.mockResolvedValueOnce({ attemptToken: "old", createdAt: 1 });
    mockJournal.mget.mockResolvedValueOnce([
      { attemptToken: "old", txHash: "0xsettled", settledAt: 2 },
      { status: "unknown" },
    ]);

    const result = await onBeforeSettle(context());
    expect(result).toEqual({ abort: true, reason: "aborted-duplicate" });
    expect(mockJournal.get).toHaveBeenCalledTimes(1);
    expect(mockJournal.set.mock.calls.some((call) => String(call[0]).endsWith(":claim")))
      .toBe(false);
  });

  it("acquires the claim, double-checks state, then writes and indexes pending", async () => {
    mockJournal.get
      .mockResolvedValueOnce(null) // initial claim
      .mockResolvedValueOnce(null) // compensation
      .mockResolvedValueOnce(null); // token collision check
    mockJournal.mget
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null, null]);

    await expect(onBeforeSettle(context())).resolves.toBeUndefined();

    const claimCall = mockJournal.set.mock.calls.findIndex((call) =>
      String(call[0]).endsWith(":claim"));
    const pendingCall = mockJournal.set.mock.calls.findIndex((call) =>
      String(call[0]).includes(":a:"));
    expect(claimCall).toBeGreaterThanOrEqual(0);
    expect(pendingCall).toBeGreaterThan(claimCall);
    expect(mockJournal.mget).toHaveBeenCalledTimes(2);
    expect(mockJournal.zadd).toHaveBeenCalledWith(
      "pending",
      expect.objectContaining({ score: expect.any(Number), member: expect.stringContaining(":a:") }),
    );
    const pendingRecord = mockJournal.set.mock.calls.find((call) =>
      String(call[0]).includes(":a:"))?.[1];
    expect(pendingRecord.authorization).toEqual({
      ...AUTHORIZATION,
      network: "eip155:84532",
      asset: "0xasset",
    });
  });

  it("fails closed when ZADD fails and marks the attempt rejected before ZREM", async () => {
    mockJournal.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: "pending",
        network: "eip155:84532",
        asset: "asset",
        amount: "1",
        payTo: "payTo",
        payer: "payer",
        url: "https://example.com",
        price: "1",
        createdAt: 1,
        updatedAt: 1,
      });
    mockJournal.mget
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([null, null]);
    mockJournal.zadd.mockRejectedValueOnce(new Error("zadd down"));

    const result = await onBeforeSettle(context());
    expect(result).toEqual({ abort: true, reason: "zadd-failed" });
    const statusSet = mockJournal.set.mock.calls.findIndex((call) => call[1]?.status === "rejected");
    expect(statusSet).toBeGreaterThanOrEqual(0);
    expect(mockJournal.set.mock.invocationCallOrder[statusSet])
      .toBeLessThan(mockJournal.zrem.mock.invocationCallOrder[0]);
  });

  it("writes final, then settled attempt, then removes the pending index", async () => {
    const hash = canonicalPaymentIdentity(context().paymentPayload);
    mockJournal.get
      .mockResolvedValueOnce({ attemptToken: "attempt", createdAt: 1 })
      .mockResolvedValueOnce({
        status: "pending",
        network: "eip155:84532",
        asset: "asset",
        amount: "1",
        payTo: "payTo",
        payer: "payer",
        url: "https://example.com",
        price: "1",
        createdAt: 1,
        updatedAt: 1,
      });
    const settleContext = {
      ...context(),
      result: {
        success: true,
        transaction: "0xtx",
        network: "eip155:84532",
      },
    } as SettleResultContext;

    await onAfterSettle(settleContext);

    expect(mockJournal.set.mock.calls[0][0]).toBe(`${hash}:final`);
    expect(mockJournal.set.mock.calls[0][2]).toEqual({ nx: true, ex: 7_776_000 });
    expect(mockJournal.set.mock.calls[1][1]).toEqual(expect.objectContaining({
      status: "settled",
      txHash: "0xtx",
    }));
    expect(mockJournal.set.mock.invocationCallOrder[1])
      .toBeLessThan(mockJournal.zrem.mock.invocationCallOrder[0]);
  });

  it("leaves pending indexed and reports when the final write throws", async () => {
    mockJournal.get.mockResolvedValueOnce({ attemptToken: "attempt", createdAt: 1 });
    mockJournal.set.mockRejectedValueOnce(new Error("final unavailable"));
    const settleContext = {
      ...context(),
      result: { success: true, transaction: "0xtx", network: "eip155:84532" },
    } as SettleResultContext;

    await onAfterSettle(settleContext);
    expect(mockJournal.zrem).not.toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ failure: "final-write" }) }),
    );
  });

  it("marks success:false rejected before removing pending", async () => {
    mockJournal.get
      .mockResolvedValueOnce({ attemptToken: "attempt", createdAt: 1 })
      .mockResolvedValueOnce({
        status: "pending",
        network: "eip155:84532",
        asset: "asset",
        amount: "1",
        payTo: "payTo",
        payer: "payer",
        url: "https://example.com",
        price: "1",
        createdAt: 1,
        updatedAt: 1,
      });
    const settleContext = {
      ...context(),
      result: {
        success: false,
        transaction: "",
        network: "eip155:84532",
        errorReason: "rejected by facilitator",
      },
    } as SettleResultContext;

    await onAfterSettle(settleContext);
    const rejectedSet = mockJournal.set.mock.calls.findIndex((call) =>
      call[1]?.status === "rejected");
    expect(rejectedSet).toBeGreaterThanOrEqual(0);
    expect(mockJournal.set.mock.invocationCallOrder[rejectedSet])
      .toBeLessThan(mockJournal.zrem.mock.invocationCallOrder[0]);
  });

  it("marks settlement exceptions unknown, reports the hash only, and keeps pending indexed", async () => {
    mockJournal.get
      .mockResolvedValueOnce({ attemptToken: "attempt", createdAt: 1 })
      .mockResolvedValueOnce({
        status: "pending",
        network: "eip155:84532",
        asset: "asset",
        amount: "1",
        payTo: "payTo",
        payer: "payer",
        url: "https://example.com",
        price: "1",
        createdAt: 1,
        updatedAt: 1,
      });
    const error = new Error("facilitator connection dropped");

    await onSettleFailure({ ...context(), error } as never);
    expect(mockJournal.set).toHaveBeenCalledWith(
      expect.stringContaining(":a:attempt"),
      expect.objectContaining({ status: "unknown", reason: "settlement-exception" }),
      { ex: 7_776_000 },
    );
    expect(mockJournal.zrem).not.toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        level: "error",
        extra: expect.not.objectContaining({ rawPayload: expect.anything() }),
      }),
    );
  });
});
