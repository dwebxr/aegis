import { D2A_FEE_TRUSTED, D2A_FEE_KNOWN, D2A_FEE_UNKNOWN } from "@/lib/agent/protocol";

const STORAGE_KEY = "aegis-d2a-reputation";

export interface PeerReputation {
  pubkey: string;
  useful: number;
  slop: number;
  score: number;
  blocked: boolean;
  updatedAt: number;
}

export type TrustTier = "trusted" | "known" | "unknown" | "restricted";

interface SerializedReputationStore {
  version: 1;
  peers: Array<[string, PeerReputation]>;
}

let _memCache: Map<string, PeerReputation> | null = null;

/** Reset in-memory cache (for test isolation). */
export function _resetReputationCache(): void { _memCache = null; }

export function loadReputations(): Map<string, PeerReputation> {
  if (_memCache) return _memCache;
  if (typeof globalThis.localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: SerializedReputationStore = JSON.parse(raw);
        if (parsed.version === 1 && Array.isArray(parsed.peers)) {
          return (_memCache = new Map(parsed.peers));
        }
      }
    } catch {
      console.warn("[d2a-reputation] Corrupted localStorage data, resetting");
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return (_memCache = new Map());
}

export function saveReputations(map: Map<string, PeerReputation>): void {
  _memCache = map;
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const store: SerializedReputationStore = {
      version: 1,
      peers: Array.from(map.entries()),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn("[d2a-reputation] Failed to persist reputations:", err);
  }
}

function getOrCreate(pubkey: string): { map: Map<string, PeerReputation>; rep: PeerReputation } {
  const map = loadReputations();
  const rep = map.get(pubkey) ?? {
    pubkey,
    useful: 0,
    slop: 0,
    score: 0,
    blocked: false,
    updatedAt: Date.now(),
  };
  return { map, rep };
}

function recalculate(rep: PeerReputation): PeerReputation {
  rep.score = rep.useful - rep.slop * 3;
  rep.blocked = rep.score <= -5;
  rep.updatedAt = Date.now();
  return rep;
}

export function recordUseful(pubkey: string): PeerReputation {
  const { map, rep } = getOrCreate(pubkey);
  rep.useful += 1;
  recalculate(rep);
  map.set(pubkey, rep);
  saveReputations(map);
  return rep;
}

export function recordSlop(pubkey: string): PeerReputation {
  const { map, rep } = getOrCreate(pubkey);
  rep.slop += 1;
  recalculate(rep);
  map.set(pubkey, rep);
  saveReputations(map);
  return rep;
}

export function isBlocked(pubkey: string): boolean {
  const map = loadReputations();
  const rep = map.get(pubkey);
  return rep?.blocked ?? false;
}

export function getReputation(pubkey: string): PeerReputation | undefined {
  const map = loadReputations();
  return map.get(pubkey);
}

function normalizeRepScore(score: number): number {
  return Math.max(0, Math.min(1, score / 10));
}

/**
 * Effective trust combines WoT social graph trust with local behavioral reputation.
 * WoT is weighted higher (60%) because it's harder to game.
 */
export function calculateEffectiveTrust(wotScore: number, repScore: number): number {
  return wotScore * 0.6 + normalizeRepScore(repScore) * 0.4;
}

export function getTrustTier(effectiveTrust: number): TrustTier {
  if (effectiveTrust >= 0.8) return "trusted";
  if (effectiveTrust >= 0.4) return "known";
  if (effectiveTrust >= 0) return "unknown";
  // effectiveTrust < 0: not expected from calculateEffectiveTrust but handled defensively
  return "restricted";
}

/** Map trust tier → fee. Returns 0 for "restricted" (callers typically filter this tier first). */
export function calculateDynamicFee(tier: TrustTier): number {
  switch (tier) {
    case "trusted": return D2A_FEE_TRUSTED;
    case "known": return D2A_FEE_KNOWN;
    case "unknown": return D2A_FEE_UNKNOWN;
    case "restricted": return 0;
  }
}
