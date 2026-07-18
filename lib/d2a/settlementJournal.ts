import { createHash, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import type {
  SettleContext,
  SettleFailureContext,
  SettleResultContext,
  VerifyResultContext,
} from "@x402/core/server";
import { journalKV } from "@/lib/api/kv/journalNamespace";
import { metricsKV } from "@/lib/api/kv/namespace";

const JOURNAL_TTL_SECONDS = 90 * 24 * 60 * 60;
const PAYMENT_WORK_TTL_SECONDS = 150;
const METRICS_TTL_SECONDS = 14 * 24 * 60 * 60;
const MAX_ATTEMPT_TOKEN_TRIES = 3;

export type SettlementAttemptStatus = "pending" | "settled" | "rejected" | "unknown";

export interface SettlementAttempt {
  status: SettlementAttemptStatus;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  payer: string;
  url: string;
  price: string;
  txHash?: string;
  createdAt: number;
  updatedAt: number;
  reason?: string;
}

export interface SettlementFinal {
  attemptToken: string;
  txHash: string;
  settledAt: number;
}

export interface SettlementClaim {
  attemptToken: string;
  createdAt: number;
}

export interface SettlementReadResult {
  final: SettlementFinal | null;
  attempt: SettlementAttempt | null;
}

function attemptKey(hash: string, attemptToken: string): string {
  return `${hash}:a:${attemptToken}`;
}

function finalKey(hash: string): string {
  return `${hash}:final`;
}

function claimKey(hash: string): string {
  return `${hash}:claim`;
}

function compensationKey(hash: string): string {
  return `${hash}:compensation`;
}

export function hashPaymentPayload(rawPaymentPayload: string): string {
  return createHash("sha256").update(rawPaymentPayload).digest("hex");
}

/**
 * Reserve paid handler work for a verified payment payload. Like the per-URL
 * score marker, this lock is intentionally never deleted: only its TTL may
 * release it, so a failed request also provides bounded retry backoff.
 */
export async function acquirePaymentWork(hash: string): Promise<boolean | undefined> {
  const result = await journalKV.set(`${hash}:work`, "reserved", {
    nx: true,
    ex: PAYMENT_WORK_TTL_SECONDS,
  });
  return result === undefined ? undefined : result === "OK";
}

export async function readClaim(hash: string): Promise<SettlementClaim | null | undefined> {
  return journalKV.get<SettlementClaim>(claimKey(hash));
}

export async function readCompensation(hash: string): Promise<unknown | null | undefined> {
  return journalKV.get<unknown>(compensationKey(hash));
}

export async function readAttempt(
  hash: string,
  attemptToken: string,
): Promise<SettlementAttempt | null | undefined> {
  return journalKV.get<SettlementAttempt>(attemptKey(hash, attemptToken));
}

export async function readFinal(hash: string): Promise<SettlementFinal | null | undefined> {
  return journalKV.get<SettlementFinal>(finalKey(hash));
}

/**
 * Read the absorbing final record and its associated attempt in one MGET. A
 * namespace implementation without MGET support falls back to final → attempt
 * → final, so a concurrently-created final can never be missed.
 */
export async function readFinalAndAttempt(
  hash: string,
  attemptToken?: string,
): Promise<SettlementReadResult> {
  if (attemptToken) {
    const values = await journalKV.mget<[
      SettlementFinal | null,
      SettlementAttempt | null,
    ]>(finalKey(hash), attemptKey(hash, attemptToken));
    if (values !== undefined) {
      return { final: values[0] ?? null, attempt: values[1] ?? null };
    }
  } else {
    const values = await journalKV.mget<[SettlementFinal | null]>(finalKey(hash));
    if (values !== undefined) return { final: values[0] ?? null, attempt: null };
  }

  const firstFinal = await readFinal(hash);
  if (firstFinal) return { final: firstFinal, attempt: null };
  const attempt = attemptToken ? await readAttempt(hash, attemptToken) : null;
  const secondFinal = await readFinal(hash);
  return { final: secondFinal ?? null, attempt: attempt ?? null };
}

export async function acquireClaim(
  hash: string,
  attemptToken: string,
  createdAt: number,
): Promise<boolean | undefined> {
  const result = await journalKV.set(
    claimKey(hash),
    { attemptToken, createdAt } satisfies SettlementClaim,
    { nx: true, ex: JOURNAL_TTL_SECONDS },
  );
  return result === undefined ? undefined : result === "OK";
}

export async function createAttempt(
  hash: string,
  build: (attemptToken: string) => SettlementAttempt,
): Promise<{ attemptToken: string; record: SettlementAttempt } | null | undefined> {
  for (let i = 0; i < MAX_ATTEMPT_TOKEN_TRIES; i++) {
    const attemptToken = randomUUID();
    const record = build(attemptToken);
    const result = await journalKV.set(attemptKey(hash, attemptToken), record, {
      nx: true,
      ex: JOURNAL_TTL_SECONDS,
    });
    if (result === undefined) return undefined;
    if (result === "OK") return { attemptToken, record };
  }
  return null;
}

async function createAttemptWithToken(
  hash: string,
  attemptToken: string,
  record: SettlementAttempt,
): Promise<boolean | undefined> {
  const result = await journalKV.set(attemptKey(hash, attemptToken), record, {
    nx: true,
    ex: JOURNAL_TTL_SECONDS,
  });
  return result === undefined ? undefined : result === "OK";
}

export async function updateAttempt(
  hash: string,
  attemptToken: string,
  update: Pick<SettlementAttempt, "status" | "updatedAt"> &
    Partial<Pick<SettlementAttempt, "txHash" | "reason">>,
): Promise<boolean> {
  const current = await readAttempt(hash, attemptToken);
  if (!current) return false;
  const result = await journalKV.set(
    attemptKey(hash, attemptToken),
    { ...current, ...update },
    { ex: JOURNAL_TTL_SECONDS },
  );
  return result === "OK";
}

/** The only final writer: append-only SET NX, with no overwrite/delete API. */
export async function writeFinal(
  hash: string,
  final: SettlementFinal,
): Promise<boolean | undefined> {
  const result = await journalKV.set(finalKey(hash), final, {
    nx: true,
    ex: JOURNAL_TTL_SECONDS,
  });
  return result === undefined ? undefined : result === "OK";
}

export async function addPending(
  hash: string,
  attemptToken: string,
  createdAt: number,
): Promise<boolean> {
  const result = await journalKV.zadd("pending", {
    score: createdAt,
    member: attemptKey(hash, attemptToken),
  });
  return result !== undefined && result !== null;
}

export async function removePending(hash: string, attemptToken: string): Promise<void> {
  await journalKV.zrem("pending", attemptKey(hash, attemptToken));
}

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function recordMetric(network: string, outcome: string, attemptToken: string): Promise<void> {
  const timestamp = Date.now();
  const zsetKey = `settle:${network}`;
  try {
    await metricsKV.zadd(zsetKey, {
      score: timestamp,
      member: `${timestamp}:${outcome}:${attemptToken}`,
    });
    await metricsKV.zremrangebyrank(zsetKey, 0, -101);
    await metricsKV.incr(`settle:${network}:${utcDate(timestamp)}:${outcome}`, {
      ex: METRICS_TTL_SECONDS,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "metrics", outcome },
      extra: { network, attemptToken },
    });
  }
}

function rawPaymentHeader(transportContext: unknown): string | null {
  if (!transportContext || typeof transportContext !== "object") return null;
  const request = (transportContext as { request?: unknown }).request;
  if (!request || typeof request !== "object") return null;
  const paymentHeader = (request as { paymentHeader?: unknown }).paymentHeader;
  if (typeof paymentHeader === "string" && paymentHeader.length > 0) return paymentHeader;
  const adapter = (request as { adapter?: unknown }).adapter;
  if (!adapter || typeof adapter !== "object") return null;
  const getHeader = (adapter as { getHeader?: unknown }).getHeader;
  if (typeof getHeader !== "function") return null;
  const value = getHeader.call(adapter, "payment-signature");
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requestUrl(context: SettleContext): string {
  if (typeof context.paymentPayload.resource?.url === "string") {
    return context.paymentPayload.resource.url;
  }
  const transport = context.transportContext;
  if (!transport || typeof transport !== "object") return "";
  const request = (transport as { request?: unknown }).request;
  if (!request || typeof request !== "object") return "";
  const adapter = (request as { adapter?: unknown }).adapter;
  if (!adapter || typeof adapter !== "object") return "";
  const getUrl = (adapter as { getUrl?: unknown }).getUrl;
  if (typeof getUrl !== "function") return "";
  const value = getUrl.call(adapter);
  return typeof value === "string" ? value : "";
}

function payer(context: SettleContext): string {
  const authorization = context.paymentPayload.payload.authorization;
  if (authorization && typeof authorization === "object") {
    const from = (authorization as { from?: unknown }).from;
    if (typeof from === "string") return from;
  }
  const direct = context.paymentPayload.payload.payer;
  return typeof direct === "string" ? direct : "";
}

function attemptRecord(
  context: SettleContext,
  status: SettlementAttemptStatus,
  timestamp: number,
  reason?: string,
): SettlementAttempt {
  return {
    status,
    network: context.requirements.network,
    asset: context.requirements.asset,
    amount: context.requirements.amount,
    payTo: context.requirements.payTo,
    payer: payer(context),
    url: requestUrl(context),
    // The accepted amount is the original authorized price; requirements.amount
    // may be a settlement override for schemes that support partial charging.
    price: context.paymentPayload.accepted.amount,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(reason ? { reason } : {}),
  };
}

async function journalRejectedAttempt(
  hash: string,
  context: SettleContext,
  reason: string,
  attemptToken?: string,
): Promise<string | undefined> {
  const timestamp = Date.now();
  if (attemptToken) {
    const created = await createAttemptWithToken(
      hash,
      attemptToken,
      attemptRecord(context, "rejected", timestamp, reason),
    );
    if (created) await removePendingAfterStatusUpdate(hash, attemptToken);
    return attemptToken;
  }
  const created = await createAttempt(hash, () =>
    attemptRecord(context, "rejected", timestamp, reason));
  if (created) await removePendingAfterStatusUpdate(hash, created.attemptToken);
  return created?.attemptToken;
}

async function removePendingAfterStatusUpdate(hash: string, attemptToken: string): Promise<void> {
  try {
    await removePending(hash, attemptToken);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "pending-zrem" },
      extra: { hash, attemptToken },
    });
  }
}

async function rejectAndAbort(
  hash: string,
  context: SettleContext,
  reason: string,
  attemptToken?: string,
): Promise<{ abort: true; reason: string }> {
  let metricToken = attemptToken;
  try {
    metricToken = await journalRejectedAttempt(hash, context, reason, attemptToken)
      ?? metricToken;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "aborted-attempt" },
      extra: { hash, reason },
    });
  }
  await recordMetric(context.requirements.network, reason, metricToken ?? randomUUID());
  return { abort: true, reason };
}

export async function onAfterVerify(context: VerifyResultContext): Promise<void> {
  if (context.result?.isValid !== true) {
    await recordMetric(context.requirements.network, "verify-failure", randomUUID());
  }
}

export async function onBeforeSettle(
  context: SettleContext,
): Promise<void | { abort: true; reason: string }> {
  const rawPayload = rawPaymentHeader(context.transportContext);
  if (!rawPayload) {
    await recordMetric(context.requirements.network, "journal-unavailable", randomUUID());
    return { abort: true, reason: "journal-unavailable" };
  }

  const hash = hashPaymentPayload(rawPayload);
  try {
    const existingClaim = await readClaim(hash);
    const initial = await readFinalAndAttempt(hash, existingClaim?.attemptToken);
    if (initial.final) return rejectAndAbort(hash, context, "aborted-duplicate");
    if (initial.attempt?.status === "unknown") {
      return rejectAndAbort(hash, context, "aborted-unknown");
    }

    const compensation = await readCompensation(hash);
    if (compensation != null) {
      return rejectAndAbort(hash, context, "aborted-compensation");
    }

    let attemptToken = "";
    for (let i = 0; i < MAX_ATTEMPT_TOKEN_TRIES; i++) {
      const candidate = randomUUID();
      if (!(await readAttempt(hash, candidate))) {
        attemptToken = candidate;
        break;
      }
    }
    if (!attemptToken) return rejectAndAbort(hash, context, "attempt-token-collision");

    const createdAt = Date.now();
    const claimed = await acquireClaim(hash, attemptToken, createdAt);
    if (claimed !== true) {
      return rejectAndAbort(
        hash,
        context,
        claimed === false ? "aborted-concurrent" : "journal-unavailable",
      );
    }

    const checked = await readFinalAndAttempt(hash, attemptToken);
    if (checked.final) {
      return rejectAndAbort(hash, context, "aborted-duplicate", attemptToken);
    }
    if (checked.attempt?.status === "unknown") {
      return rejectAndAbort(hash, context, "aborted-unknown", attemptToken);
    }

    const record = attemptRecord(context, "pending", createdAt);
    const created = await createAttemptWithToken(hash, attemptToken, record);
    if (created !== true) {
      return rejectAndAbort(
        hash,
        context,
        created === false ? "attempt-token-collision" : "journal-unavailable",
        attemptToken,
      );
    }

    try {
      const indexed = await addPending(hash, attemptToken, createdAt);
      if (!indexed) throw new Error("Pending index is unavailable");
    } catch (error) {
      let updated = false;
      try {
        updated = await updateAttempt(hash, attemptToken, {
          status: "rejected",
          updatedAt: Date.now(),
          reason: "zadd-failed",
        });
      } catch {
        // The Sentry event below carries the durable record identity for repair.
      }
      if (updated) await removePendingAfterStatusUpdate(hash, attemptToken);
      Sentry.captureException(error, {
        tags: { module: "settlementJournal", failure: "pending-zadd" },
        extra: { hash, attemptToken, recordKey: attemptKey(hash, attemptToken) },
      });
      await recordMetric(context.requirements.network, "zadd-failed", attemptToken);
      return { abort: true, reason: "zadd-failed" };
    }

  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "before-settle" },
      extra: { hash },
    });
    await recordMetric(context.requirements.network, "journal-unavailable", randomUUID());
    return { abort: true, reason: "journal-unavailable" };
  }
}

export async function onAfterSettle(context: SettleResultContext): Promise<void> {
  const rawPayload = rawPaymentHeader(context.transportContext);
  if (!rawPayload) {
    Sentry.captureException(new Error("Missing raw payment payload after settlement"), {
      tags: { module: "settlementJournal", failure: "missing-payment-header" },
    });
    return;
  }
  const hash = hashPaymentPayload(rawPayload);
  let claim: SettlementClaim | null | undefined;
  try {
    claim = await readClaim(hash);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "claim-read-after-settle" },
      extra: { hash },
    });
    return;
  }
  if (!claim) {
    Sentry.captureException(new Error("Missing settlement claim after settlement"), {
      tags: { module: "settlementJournal", failure: "missing-claim" },
      extra: { hash },
    });
    return;
  }

  const { attemptToken } = claim;
  if (context.result.success === true) {
    const settledAt = Date.now();
    let finalWritten: boolean | undefined;
    try {
      finalWritten = await writeFinal(hash, {
        attemptToken,
        txHash: context.result.transaction,
        settledAt,
      });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { module: "settlementJournal", failure: "final-write" },
        extra: { hash, attemptToken },
      });
      await recordMetric(context.requirements.network, "success", attemptToken);
      return;
    }
    if (finalWritten === undefined) {
      Sentry.captureException(new Error("Final journal is unavailable"), {
        tags: { module: "settlementJournal", failure: "final-write" },
        extra: { hash, attemptToken },
      });
      await recordMetric(context.requirements.network, "success", attemptToken);
      return;
    }

    try {
      const updated = await updateAttempt(hash, attemptToken, {
        status: "settled",
        updatedAt: settledAt,
        txHash: context.result.transaction,
      });
      if (!updated) throw new Error("Settled attempt update failed");
      await removePendingAfterStatusUpdate(hash, attemptToken);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { module: "settlementJournal", failure: "settled-update" },
        extra: { hash, attemptToken },
      });
    }
    await recordMetric(context.requirements.network, "success", attemptToken);
    return;
  }

  try {
    const updated = await updateAttempt(hash, attemptToken, {
      status: "rejected",
      updatedAt: Date.now(),
      reason: context.result.errorReason || "settlement-failed",
    });
    if (!updated) throw new Error("Rejected attempt update failed");
    await removePendingAfterStatusUpdate(hash, attemptToken);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "rejected-update" },
      extra: { hash, attemptToken },
    });
  }
  await recordMetric(context.requirements.network, "failure", attemptToken);
}

export async function onSettleFailure(context: SettleFailureContext): Promise<void> {
  const rawPayload = rawPaymentHeader(context.transportContext);
  const hash = rawPayload ? hashPaymentPayload(rawPayload) : "unavailable";
  let attemptToken = "unavailable";
  if (rawPayload) {
    try {
      const claim = await readClaim(hash);
      if (claim) {
        attemptToken = claim.attemptToken;
        const updated = await updateAttempt(hash, attemptToken, {
          status: "unknown",
          updatedAt: Date.now(),
          reason: "settlement-exception",
        });
        if (!updated) throw new Error("Unknown attempt update failed");
      }
    } catch (error) {
      Sentry.captureException(error, {
        level: "error",
        tags: { module: "settlementJournal", failure: "unknown-update" },
        extra: { hash, attemptToken },
      });
    }
  }

  Sentry.captureException(context.error, {
    level: "error",
    tags: { module: "settlementJournal", failure: "settlement-unknown" },
    extra: { hash, attemptToken },
  });
  await recordMetric(context.requirements.network, "unknown", attemptToken);
}
