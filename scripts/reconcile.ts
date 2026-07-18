import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import {
  acquireRunbookLock,
  assertCompensationTombstonesPermanent,
  incrementRunbookEpoch,
  listResolutions,
  listStalePending,
  readReconcileCandidate,
  readRunbookEpoch,
  readRunbookLock,
  writeCompensationTombstone,
  writeResolution,
  type IndexedResolution,
  type ReconcileResolution,
} from "@/lib/api/kv/reconcileJournal";
import type { SettlementAttempt, SettlementFinal } from "@/lib/d2a/settlementJournal";
import { verifySettlement } from "@/scripts/verify-settlement";

const STALE_AFTER_MS = 60 * 60 * 1_000;
const MIN_REMAINING_TTL_SECONDS = 7 * 24 * 60 * 60;
const LEASE_MS = 600 * 1_000;

export interface ReconcileCandidateReport {
  hash: string;
  attemptToken: string;
  status: SettlementAttempt["status"] | "missing";
  ageMs: number | null;
  attemptTtl: number | null;
  finalExists: boolean;
  eligible: boolean;
  note: string;
}

export interface ResolutionWarning {
  hash: string;
  multiple: boolean;
  stale: boolean;
  resolutions: IndexedResolution[];
}

export interface ReconcileReport {
  ownerToken: string;
  epoch: number;
  leaseDeadline: number;
  compensationTtlSamples: number;
  candidates: ReconcileCandidateReport[];
  resolutions: IndexedResolution[];
  resolutionWarnings: ResolutionWarning[];
}

function parsePendingMember(member: string): { hash: string; attemptToken: string } | null {
  const match = /^([0-9a-f]{64}):a:(.+)$/i.exec(member);
  return match ? { hash: match[1].toLowerCase(), attemptToken: match[2] } : null;
}

export function resolutionWarnings(
  resolutions: IndexedResolution[],
  currentEpoch: number,
): ResolutionWarning[] {
  const grouped = new Map<string, IndexedResolution[]>();
  for (const resolution of resolutions) {
    const existing = grouped.get(resolution.hash) ?? [];
    existing.push(resolution);
    grouped.set(resolution.hash, existing);
  }
  return [...grouped.entries()].map(([hash, records]) => ({
    hash,
    multiple: records.length > 1,
    stale: records.some((record) => record.epoch < currentEpoch),
    resolutions: records.sort((left, right) => left.epoch - right.epoch),
  })).filter((warning) => warning.multiple || warning.stale);
}

async function assertLease(ownerToken: string, leaseDeadline: number): Promise<void> {
  if (Date.now() >= leaseDeadline) throw new Error("Runbook lease deadline exceeded");
  const owner = await readRunbookLock();
  if (owner !== ownerToken) throw new Error("Runbook lock ownership was lost");
}

export async function runReconcileReport(ownerToken: string = randomUUID()): Promise<ReconcileReport> {
  const acquiredAt = Date.now();
  const leaseDeadline = acquiredAt + LEASE_MS;
  const acquired = await acquireRunbookLock(ownerToken);
  if (acquired === undefined) throw new Error("Journal KV is unavailable");
  if (!acquired) throw new Error("Another reconciliation run owns runbook-lock");

  await assertLease(ownerToken, leaseDeadline);
  const epoch = await incrementRunbookEpoch();
  if (epoch === undefined) throw new Error("Journal KV is unavailable");
  const compensationTtlSamples = await assertCompensationTombstonesPermanent();

  const cutoff = acquiredAt - STALE_AFTER_MS;
  const pending = await listStalePending(cutoff);
  if (pending === undefined) throw new Error("Journal KV is unavailable");
  const candidates: ReconcileCandidateReport[] = [];
  for (const member of pending) {
    const identity = parsePendingMember(member);
    if (!identity) {
      candidates.push({
        hash: "invalid",
        attemptToken: member,
        status: "missing",
        ageMs: null,
        attemptTtl: null,
        finalExists: false,
        eligible: false,
        note: "invalid-pending-member-report-only",
      });
      continue;
    }
    const snapshot = await readReconcileCandidate<SettlementAttempt, SettlementFinal>(
      identity.hash,
      identity.attemptToken,
    );
    const ageMs = snapshot.attempt ? acquiredAt - snapshot.attempt.createdAt : null;
    const oldEnough = ageMs !== null && ageMs > STALE_AFTER_MS;
    const ttlSafe = snapshot.attemptTtl !== undefined
      && snapshot.attemptTtl >= MIN_REMAINING_TTL_SECONDS;
    const eligible = Boolean(snapshot.attempt && !snapshot.final && oldEnough && ttlSafe);
    candidates.push({
      ...identity,
      status: snapshot.attempt?.status ?? "missing",
      ageMs,
      attemptTtl: snapshot.attemptTtl ?? null,
      finalExists: snapshot.final !== null,
      eligible,
      note: snapshot.final
        ? "final-exists-stop"
        : !snapshot.attempt
          ? "attempt-missing-report-only"
          : !oldEnough
            ? "younger-than-one-hour-report-only"
            : !ttlSafe
              ? "ttl-under-seven-days-report-only"
              : "eligible-for-manual-resolution",
    });
  }

  const resolutions = await listResolutions();
  const currentEpoch = await readRunbookEpoch();
  if (currentEpoch === undefined || currentEpoch === null) {
    throw new Error("Runbook epoch is unavailable");
  }
  return {
    ownerToken,
    epoch,
    leaseDeadline,
    compensationTtlSamples,
    candidates,
    resolutions,
    resolutionWarnings: resolutionWarnings(resolutions, currentEpoch),
  };
}

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${flag}`);
    if (parsed[flag.slice(2)] !== undefined) throw new Error(`Duplicate argument: ${flag}`);
    parsed[flag.slice(2)] = value;
  }
  return parsed;
}

function requireOption(options: Record<string, string>, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function selectEligible(
  report: ReconcileReport,
  hash: string,
  attemptToken: string,
): ReconcileCandidateReport {
  const candidate = report.candidates.find((entry) =>
    entry.hash === hash && entry.attemptToken === attemptToken);
  if (!candidate?.eligible) throw new Error("Target is not an eligible stale candidate");
  return candidate;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.resolve && options.compensate) {
    throw new Error("Resolve and compensate are separate one-item operations");
  }
  const report = await runReconcileReport();

  if (options.resolve) {
    const hash = options.resolve.toLowerCase();
    const attemptToken = requireOption(options, "attempt-token");
    selectEligible(report, hash, attemptToken);
    const resolutionToken = options["resolution-token"] || randomUUID();
    const record: ReconcileResolution = {
      epoch: report.epoch,
      hash,
      attemptToken,
      outcome: requireOption(options, "outcome"),
      evidence: options.evidence ? JSON.parse(options.evidence) as Record<string, unknown> : {},
      createdAt: Date.now(),
      ...(options.operator ? { operator: options.operator } : {}),
    };
    const written = await writeResolution(
      hash,
      resolutionToken,
      { ...record },
      () => assertLease(report.ownerToken, report.leaseDeadline),
    );
    if (written !== true) throw new Error("Append-only resolution SET NX failed");
  }

  let compensation: Record<string, unknown> | undefined;
  if (options.compensate) {
    if (options.compensate.includes(",")) throw new Error("Batch compensation is forbidden");
    const hash = options.compensate.toLowerCase();
    const attemptToken = requireOption(options, "attempt-token");
    selectEligible(report, hash, attemptToken);

    // Required immediate pre-send journal re-read: an absorbing final always wins.
    const snapshot = await readReconcileCandidate<SettlementAttempt, SettlementFinal>(hash, attemptToken);
    if (snapshot.final) throw new Error("Settlement final appeared; compensation stopped");
    if (!snapshot.attempt) throw new Error("Settlement attempt disappeared; compensation stopped");

    const client = createPublicClient({
      chain: base,
      transport: http(options["rpc-url"] || process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    });
    const verified = await verifySettlement(client, {
      txHash: (options.tx || snapshot.attempt.txHash) as Hex | undefined,
      payer: (options.payer || snapshot.attempt.payer) as Address,
      payTo: (options["pay-to"] || snapshot.attempt.payTo) as Address,
      amount: BigInt(options.amount || snapshot.attempt.amount),
      nonce: requireOption(options, "nonce") as Hex,
      validBefore: BigInt(requireOption(options, "valid-before")),
    });
    if (verified.status !== "closed-unpaid" || !verified.evidence.compensationAllowed) {
      throw new Error(`Compensation is not authorized: ${verified.evidence.reason}`);
    }

    // --ledger-ref is the operator's assertion that the external ledger entry
    // was committed immediately before this irreversible tombstone write.
    const ledgerRef = requireOption(options, "ledger-ref");
    const tombstoned = await writeCompensationTombstone(hash, {
      attemptToken,
      epoch: report.epoch,
      ledgerRef,
      verification: verified.evidence,
      createdAt: Date.now(),
    }, () => assertLease(report.ownerToken, report.leaseDeadline));
    if (tombstoned !== true) throw new Error("Compensation tombstone SET NX failed; do not send");
    compensation = {
      hash,
      attemptToken,
      ledgerRef,
      authorizedToSendOneTransfer: true,
      warning: "Send exactly one transfer, then stop. This script never sends funds.",
    };
  }

  console.log(JSON.stringify({ ...report, compensation }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
