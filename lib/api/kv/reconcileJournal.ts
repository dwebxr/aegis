import { kvNamespace } from "./internal/factory";

const reconcileKV = kvNamespace("aegis:journal:");
const reconcileMetricsKV = kvNamespace("aegis:metrics:");

const RUNBOOK_LOCK_SECONDS = 900;

export interface ReconcileResolution {
  epoch: number;
  hash: string;
  attemptToken: string;
  outcome: string;
  evidence: Record<string, unknown>;
  createdAt: number;
  operator?: string;
}

export interface IndexedResolution extends ReconcileResolution {
  key: string;
}

function resolutionKey(hash: string, resolutionToken: string): string {
  return `${hash}:resolution:${resolutionToken}`;
}

export async function writeResolution(
  hash: string,
  resolutionToken: string,
  resolution: Record<string, unknown>,
  beforeWrite: () => Promise<void>,
): Promise<boolean | undefined> {
  const epoch = resolution.epoch;
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 1) {
    throw new Error("Resolution epoch must be a positive safe integer");
  }
  const key = resolutionKey(hash, resolutionToken);
  await beforeWrite();
  const result = await reconcileKV.set(
    key,
    resolution,
    { nx: true },
  );
  if (result === undefined || result === null) return result === undefined ? undefined : false;
  await beforeWrite();
  const indexed = await reconcileKV.zadd("resolution-index", { score: epoch, member: key });
  if (indexed === undefined || indexed === null) {
    throw new Error(`Resolution was written but could not be indexed: ${key}`);
  }
  return true;
}

export function readResolution<T>(
  hash: string,
  resolutionToken: string,
): Promise<T | null | undefined> {
  return reconcileKV.get<T>(resolutionKey(hash, resolutionToken));
}

export function readJournalReport<T extends unknown[]>(...keys: string[]): Promise<T | undefined> {
  return reconcileKV.mget<T>(...keys);
}

export async function acquireRunbookLock(ownerToken: string): Promise<boolean | undefined> {
  const result = await reconcileKV.set("runbook-lock", ownerToken, {
    nx: true,
    ex: RUNBOOK_LOCK_SECONDS,
  });
  return result === undefined ? undefined : result === "OK";
}

export function readRunbookLock(): Promise<string | null | undefined> {
  return reconcileKV.get<string>("runbook-lock");
}

export function incrementRunbookEpoch(): Promise<number | undefined> {
  return reconcileKV.incr("runbook-epoch");
}

export function readRunbookEpoch(): Promise<number | null | undefined> {
  return reconcileKV.get<number>("runbook-epoch");
}

export function listStalePending(beforeTimestamp: number): Promise<string[] | undefined> {
  return reconcileKV.zrange<string[]>("pending", "-inf", beforeTimestamp, { byScore: true });
}

export async function readReconcileCandidate<TAttempt, TFinal>(
  hash: string,
  attemptToken: string,
): Promise<{
  attempt: TAttempt | null;
  final: TFinal | null;
  attemptTtl: number | undefined;
}> {
  const attemptKey = `${hash}:a:${attemptToken}`;
  const values = await reconcileKV.mget<[TFinal | null, TAttempt | null]>(
    `${hash}:final`,
    attemptKey,
  );
  const attemptTtl = await reconcileKV.ttl(attemptKey);
  return {
    final: values?.[0] ?? null,
    attempt: values?.[1] ?? null,
    attemptTtl,
  };
}

export async function listResolutions(): Promise<IndexedResolution[]> {
  const keys = await reconcileKV.zrange<string[]>("resolution-index", 0, -1);
  if (!keys?.length) return [];
  const records = await reconcileKV.mget<Array<ReconcileResolution | null>>(...keys);
  if (!records) throw new Error("Resolution records are unavailable");
  return records
    .flatMap((record, index) => record ? [{ ...record, key: keys[index] }] : [])
    .sort((left, right) => left.epoch - right.epoch);
}

export async function writeCompensationTombstone(
  hash: string,
  value: Record<string, unknown>,
  beforeWrite: () => Promise<void>,
): Promise<boolean | undefined> {
  const key = `${hash}:compensation`;
  await beforeWrite();
  const result = await reconcileKV.set(key, value, { nx: true });
  if (result === undefined || result === null) return result === undefined ? undefined : false;
  await beforeWrite();
  const indexed = await reconcileKV.zadd("compensation-index", {
    score: Date.now(),
    member: key,
  });
  if (indexed === undefined || indexed === null) {
    throw new Error(`Compensation tombstone was written but could not be indexed: ${key}`);
  }
  return true;
}

export async function assertCompensationTombstonesPermanent(sampleSize = 20): Promise<number> {
  const keys = await reconcileKV.zrange<string[]>("compensation-index", -sampleSize, -1);
  if (!keys?.length) return 0;
  for (const key of keys) {
    const ttl = await reconcileKV.ttl(key);
    if (ttl !== -1) throw new Error(`Compensation tombstone must have TTL -1: ${key} has ${ttl}`);
  }
  return keys.length;
}

export function readSettlementMetrics(
  network: string,
  count: number,
): Promise<string[] | undefined> {
  return reconcileMetricsKV.zrange<string[]>(`settle:${network}`, -count, -1);
}
