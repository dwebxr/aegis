import { createHash, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import type {
  HTTPTransportContext,
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

export interface SettlementAuthorization {
  from: string;
  to: string;
  value: string;
  nonce: string;
  validAfter: string;
  validBefore: string;
  network: string;
  asset: string;
}

export interface SettlementAttempt {
  status: SettlementAttemptStatus;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  payer: string;
  url: string;
  price: string;
  authorization: SettlementAuthorization;
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

export interface PaymentDurableState {
  final: SettlementFinal | null;
  claim: SettlementClaim | null;
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

function objectField(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid payment payload: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, field: string, path: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid payment payload: ${path}.${field} must be a non-empty string`);
  }
  return value;
}

function paymentAuthorizationRecords(paymentPayload: unknown): {
  accepted: Record<string, unknown>;
  authorization: Record<string, unknown>;
} {
  const payment = objectField(paymentPayload, "paymentPayload");
  const accepted = objectField(payment.accepted, "paymentPayload.accepted");
  const payload = objectField(payment.payload, "paymentPayload.payload");
  const authorization = objectField(
    payload.authorization,
    "paymentPayload.payload.authorization",
  );
  return { accepted, authorization };
}

function paymentAuthorization(paymentPayload: unknown): SettlementAuthorization {
  const { accepted, authorization } = paymentAuthorizationRecords(paymentPayload);
  return {
    from: stringField(authorization, "from", "paymentPayload.payload.authorization"),
    to: stringField(authorization, "to", "paymentPayload.payload.authorization"),
    value: stringField(authorization, "value", "paymentPayload.payload.authorization"),
    nonce: stringField(authorization, "nonce", "paymentPayload.payload.authorization"),
    validAfter: stringField(
      authorization,
      "validAfter",
      "paymentPayload.payload.authorization",
    ),
    validBefore: stringField(
      authorization,
      "validBefore",
      "paymentPayload.payload.authorization",
    ),
    network: stringField(accepted, "network", "paymentPayload.accepted"),
    asset: stringField(accepted, "asset", "paymentPayload.accepted"),
  };
}

/** EIP-3009's on-chain idempotency identity: network + authorizer + nonce. */
export function canonicalPaymentIdentity(paymentPayload: unknown): string {
  const { accepted, authorization } = paymentAuthorizationRecords(paymentPayload);
  const network = stringField(accepted, "network", "paymentPayload.accepted");
  const from = stringField(authorization, "from", "paymentPayload.payload.authorization");
  const nonce = stringField(authorization, "nonce", "paymentPayload.payload.authorization");
  return createHash("sha256")
    .update(`${network}:${from.toLowerCase()}:${nonce.toLowerCase()}`)
    .digest("hex");
}

/**
 * Reserve paid handler work for a verified payment payload. Like the per-URL
 * score marker, this lock is intentionally never deleted: only its TTL may
 * release it, so a failed request also provides bounded retry backoff.
 */
export async function acquirePaymentWork(identity: string): Promise<boolean | undefined> {
  const result = await journalKV.set(`${identity}:work`, "reserved", {
    nx: true,
    ex: PAYMENT_WORK_TTL_SECONDS,
  });
  return result === undefined ? undefined : result === "OK";
}

/** Read both durable payment-use markers before reserving expensive score work. */
export async function readPaymentDurableState(
  hash: string,
): Promise<PaymentDurableState | undefined> {
  const values = await journalKV.mget<[
    SettlementFinal | null,
    SettlementClaim | null,
  ]>(finalKey(hash), claimKey(hash));
  if (values === undefined) return undefined;
  return { final: values[0] ?? null, claim: values[1] ?? null };
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

async function recordMetric(
  phase: "settle" | "verify",
  network: string,
  outcome: string,
  attemptToken: string,
): Promise<void> {
  const timestamp = Date.now();
  const zsetKey = `${phase}:${network}`;
  try {
    await metricsKV.zadd(zsetKey, {
      score: timestamp,
      member: `${timestamp}:${outcome}:${attemptToken}`,
    });
    await metricsKV.zremrangebyrank(zsetKey, 0, -101);
    await metricsKV.incr(`${phase}:${network}:${utcDate(timestamp)}:${outcome}`, {
      ex: METRICS_TTL_SECONDS,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "metrics", phase, outcome },
      extra: { network, attemptToken },
    });
  }
}

function recordSettleMetric(
  network: string,
  outcome: string,
  attemptToken: string,
): Promise<void> {
  return recordMetric("settle", network, outcome, attemptToken);
}

function recordVerifyMetric(
  network: string,
  outcome: "success" | "failure",
  attemptToken: string,
): Promise<void> {
  return recordMetric("verify", network, outcome, attemptToken);
}

function requestUrl(context: SettleContext): string {
  const transport = context.transportContext as HTTPTransportContext | undefined;
  const adapter = transport?.request?.adapter;
  const getUrl = adapter?.getUrl;
  if (typeof getUrl !== "function") return "";
  const value = getUrl.call(adapter);
  return typeof value === "string" ? value : "";
}

function journalUrl(context: SettleContext): string {
  const value = requestUrl(context);
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Malformed/relative transport URLs still must not retain secrets in a
    // query or fragment.
    return value.split(/[?#]/, 1)[0] ?? "";
  }
}

function attemptRecord(
  context: SettleContext,
  status: SettlementAttemptStatus,
  timestamp: number,
  reason?: string,
): SettlementAttempt {
  const authorization = paymentAuthorization(context.paymentPayload);
  return {
    status,
    network: context.requirements.network,
    asset: context.requirements.asset,
    amount: context.requirements.amount,
    payTo: context.requirements.payTo,
    payer: authorization.from,
    url: journalUrl(context),
    // The accepted amount is the original authorized price; requirements.amount
    // may be a settlement override for schemes that support partial charging.
    price: context.paymentPayload.accepted.amount,
    authorization,
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
  // A settle SLO sample begins only after this request owns the claim.
  if (attemptToken) {
    await recordSettleMetric(context.requirements.network, reason, metricToken ?? attemptToken);
  }
  return { abort: true, reason };
}

export async function onAfterVerify(context: VerifyResultContext): Promise<void> {
  await recordVerifyMetric(
    context.requirements.network,
    context.result?.isValid === true ? "success" : "failure",
    randomUUID(),
  );
}

export async function onBeforeSettle(
  context: SettleContext,
): Promise<void | { abort: true; reason: string }> {
  let hash: string;
  let claimedAttemptToken: string | undefined;
  try {
    hash = canonicalPaymentIdentity(context.paymentPayload);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "invalid-payment-identity" },
    });
    return { abort: true, reason: "journal-unavailable" };
  }
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
    claimedAttemptToken = attemptToken;

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
      await recordSettleMetric(context.requirements.network, "zadd-failed", attemptToken);
      return { abort: true, reason: "zadd-failed" };
    }

  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "before-settle" },
      extra: { hash },
    });
    if (claimedAttemptToken) {
      await recordSettleMetric(
        context.requirements.network,
        "journal-unavailable",
        claimedAttemptToken,
      );
    }
    return { abort: true, reason: "journal-unavailable" };
  }
}

export async function onAfterSettle(context: SettleResultContext): Promise<void> {
  let hash: string;
  try {
    hash = canonicalPaymentIdentity(context.paymentPayload);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "settlementJournal", failure: "invalid-payment-identity-after-settle" },
    });
    return;
  }
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
      await recordSettleMetric(context.requirements.network, "success", attemptToken);
      return;
    }
    if (finalWritten === undefined) {
      Sentry.captureException(new Error("Final journal is unavailable"), {
        tags: { module: "settlementJournal", failure: "final-write" },
        extra: { hash, attemptToken },
      });
      await recordSettleMetric(context.requirements.network, "success", attemptToken);
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
    await recordSettleMetric(context.requirements.network, "success", attemptToken);
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
  await recordSettleMetric(context.requirements.network, "failure", attemptToken);
}

export async function onSettleFailure(context: SettleFailureContext): Promise<void> {
  let hash = "unavailable";
  let attemptToken = "unavailable";
  let claimAcquired = false;
  try {
    hash = canonicalPaymentIdentity(context.paymentPayload);
  } catch (error) {
    Sentry.captureException(error, {
      level: "error",
      tags: { module: "settlementJournal", failure: "invalid-payment-identity-on-failure" },
    });
  }
  if (hash !== "unavailable") {
    try {
      const claim = await readClaim(hash);
      if (claim) {
        attemptToken = claim.attemptToken;
        claimAcquired = true;
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
  if (claimAcquired) {
    await recordSettleMetric(context.requirements.network, "unknown", attemptToken);
  }
}
