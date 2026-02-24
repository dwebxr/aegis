const STORAGE_KEY = "aegis_publish_reputations";

/** Below this score, ICP deposit is required to publish */
export const PUBLISH_DEPOSIT_THRESHOLD = -3;

/** Below this score, publishing is suspended entirely */
export const PUBLISH_BLOCK_THRESHOLD = -10;

/** Natural recovery: +1 per 7 days of inactivity, capped at 0 */
const RECOVERY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECOVERY_SCORE = 0;

export interface PublishReputation {
  pubkey: string;
  validated: number;
  flagged: number;
  score: number;
  lastActionAt: number;
  updatedAt: number;
}

export interface PublishGateDecision {
  canPublish: boolean;
  requiresDeposit: boolean;
  reason: string;
}

interface SerializedStore {
  version: 1;
  entries: Array<[string, PublishReputation]>;
}

// Persistence — mirrors lib/d2a/reputation.ts pattern

export function loadPublishReputations(): Map<string, PublishReputation> {
  if (typeof globalThis.localStorage === "undefined") return new Map();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return new Map();
  try {
    const parsed: SerializedStore = JSON.parse(raw);
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return new Map();
    return new Map(parsed.entries);
  } catch {
    console.warn("[publishGate] Corrupted localStorage data, resetting");
    localStorage.removeItem(STORAGE_KEY);
    return new Map();
  }
}

export function savePublishReputations(map: Map<string, PublishReputation>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const store: SerializedStore = { version: 1, entries: Array.from(map.entries()) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn("[publishGate] Failed to save reputations:", err);
  }
}

export function getPublishReputation(pubkey: string): PublishReputation | undefined {
  return loadPublishReputations().get(pubkey);
}

// Recovery

/**
 * Compute recovery-adjusted score without persisting.
 * +1 per 7-day period since lastActionAt, capped at MAX_RECOVERY_SCORE (0).
 */
export function applyReputationRecovery(rep: PublishReputation): PublishReputation {
  if (rep.score >= MAX_RECOVERY_SCORE) return rep;
  const elapsed = Date.now() - rep.lastActionAt;
  if (elapsed < RECOVERY_INTERVAL_MS) return rep;
  const periods = Math.floor(elapsed / RECOVERY_INTERVAL_MS);
  const recovered = Math.min(rep.score + periods, MAX_RECOVERY_SCORE);
  return { ...rep, score: recovered };
}

// Gate check

export function checkPublishGate(pubkey: string): PublishGateDecision {
  const rep = getPublishReputation(pubkey);

  if (!rep) {
    return { canPublish: true, requiresDeposit: false, reason: "Welcome! You can publish signals freely." };
  }

  const effective = applyReputationRecovery(rep);

  if (effective.score >= PUBLISH_DEPOSIT_THRESHOLD) {
    return { canPublish: true, requiresDeposit: false, reason: "Good standing \u2014 no deposit required." };
  }

  if (effective.score >= PUBLISH_BLOCK_THRESHOLD) {
    return { canPublish: true, requiresDeposit: true, reason: "Quality deposit required. Your recent signals received low ratings." };
  }

  return { canPublish: false, requiresDeposit: false, reason: "Publishing suspended due to repeated low-quality signals." };
}

// Reputation updates

function getOrCreate(pubkey: string): { map: Map<string, PublishReputation>; rep: PublishReputation } {
  const map = loadPublishReputations();
  const existing = map.get(pubkey);
  const rep: PublishReputation = existing ?? {
    pubkey,
    validated: 0,
    flagged: 0,
    score: 0,
    lastActionAt: Date.now(),
    updatedAt: Date.now(),
  };
  return { map, rep };
}

function recalculate(rep: PublishReputation): void {
  rep.score = rep.validated - rep.flagged * 2;
  rep.lastActionAt = Date.now();
  rep.updatedAt = Date.now();
}

export function recordPublishValidation(pubkey: string): PublishReputation {
  const { map, rep } = getOrCreate(pubkey);
  rep.validated += 1;
  recalculate(rep);
  map.set(pubkey, rep);
  savePublishReputations(map);
  return rep;
}

export function recordPublishFlag(pubkey: string): PublishReputation {
  const { map, rep } = getOrCreate(pubkey);
  rep.flagged += 1;
  recalculate(rep);
  map.set(pubkey, rep);
  savePublishReputations(map);
  return rep;
}
