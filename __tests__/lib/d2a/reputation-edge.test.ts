// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  },
  writable: true,
  configurable: true,
});

import {
  loadReputations,
  saveReputations,
  recordUseful,
  recordSlop,
  isBlocked,
  getReputation,
  calculateEffectiveTrust,
  getTrustTier,
  calculateDynamicFee,
  _resetReputationCache,
  type PeerReputation,
} from "@/lib/d2a/reputation";
import { D2A_FEE_TRUSTED, D2A_FEE_KNOWN, D2A_FEE_UNKNOWN } from "@/lib/agent/protocol";

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  _resetReputationCache();
});

describe("reputation — blocking threshold", () => {
  it("blocks peer after score drops to -5 (slop * 3)", () => {
    // 2 slop reports: score = 0 - 2*3 = -6 -> blocked
    recordSlop("bad-peer");
    expect(isBlocked("bad-peer")).toBe(false); // score = -3
    recordSlop("bad-peer");
    expect(isBlocked("bad-peer")).toBe(true); // score = -6
  });

  it("unblocks peer when useful reports recover score above -5", () => {
    recordSlop("recovering");
    recordSlop("recovering");
    expect(isBlocked("recovering")).toBe(true); // score = -6

    // 7 useful reports: score = 7 - 6 = 1
    for (let i = 0; i < 7; i++) recordUseful("recovering");
    expect(isBlocked("recovering")).toBe(false);
  });

  it("handles large number of interactions", () => {
    for (let i = 0; i < 100; i++) recordUseful("popular");
    const rep = getReputation("popular")!;
    expect(rep.useful).toBe(100);
    expect(rep.score).toBe(100);
    expect(rep.blocked).toBe(false);
  });
});

describe("loadReputations — corrupted data", () => {
  it("returns empty map for corrupted JSON", () => {
    store["aegis-d2a-reputation"] = "{{broken";
    const map = loadReputations();
    expect(map.size).toBe(0);
    // Should have cleaned up the corrupted data
    expect(store["aegis-d2a-reputation"]).toBeUndefined();
  });

  it("returns empty map for wrong version", () => {
    store["aegis-d2a-reputation"] = JSON.stringify({ version: 99, peers: [] });
    const map = loadReputations();
    expect(map.size).toBe(0);
  });

  it("returns empty map for missing peers array", () => {
    store["aegis-d2a-reputation"] = JSON.stringify({ version: 1 });
    const map = loadReputations();
    expect(map.size).toBe(0);
  });

  it("uses memory cache after first load", () => {
    recordUseful("cached-peer");
    // Corrupt storage after first load
    store["aegis-d2a-reputation"] = "corrupted";
    // Should still return cached data
    const map = loadReputations();
    expect(map.get("cached-peer")).toBeDefined();
  });
});

describe("saveReputations — persistence", () => {
  it("serializes Map to versioned JSON", () => {
    const map = new Map<string, PeerReputation>();
    map.set("pk1", { pubkey: "pk1", useful: 5, slop: 0, score: 5, blocked: false, updatedAt: 1000 });
    saveReputations(map);

    const stored = JSON.parse(store["aegis-d2a-reputation"]);
    expect(stored.version).toBe(1);
    expect(stored.peers).toHaveLength(1);
    expect(stored.peers[0][0]).toBe("pk1");
    expect(stored.peers[0][1].useful).toBe(5);
  });
});

describe("calculateEffectiveTrust", () => {
  it("weights WoT at 60% and reputation at 40%", () => {
    // WoT = 1.0, Rep = 10 (normalized to 1.0) → 0.6 + 0.4 = 1.0
    expect(calculateEffectiveTrust(1.0, 10)).toBe(1.0);
  });

  it("handles zero scores", () => {
    expect(calculateEffectiveTrust(0, 0)).toBe(0);
  });

  it("normalizes reputation score to 0-1 range", () => {
    // repScore = 5 → normalized = 0.5, WoT = 0 → 0 + 0.2 = 0.2
    expect(calculateEffectiveTrust(0, 5)).toBeCloseTo(0.2);
  });

  it("clamps negative reputation to 0", () => {
    // repScore = -10 → normalized = max(0, -1) = 0
    expect(calculateEffectiveTrust(0, -10)).toBe(0);
  });

  it("clamps reputation above 10 to 1", () => {
    // repScore = 20 → normalized = min(1, 2) = 1
    expect(calculateEffectiveTrust(0, 20)).toBeCloseTo(0.4);
  });
});

describe("getTrustTier", () => {
  it("returns 'trusted' for >= 0.8", () => {
    expect(getTrustTier(0.8)).toBe("trusted");
    expect(getTrustTier(1.0)).toBe("trusted");
  });

  it("returns 'known' for >= 0.4 and < 0.8", () => {
    expect(getTrustTier(0.4)).toBe("known");
    expect(getTrustTier(0.79)).toBe("known");
  });

  it("returns 'unknown' for >= 0 and < 0.4", () => {
    expect(getTrustTier(0)).toBe("unknown");
    expect(getTrustTier(0.39)).toBe("unknown");
  });

  it("returns 'restricted' for < 0", () => {
    expect(getTrustTier(-0.01)).toBe("restricted");
    expect(getTrustTier(-1)).toBe("restricted");
  });
});

describe("calculateDynamicFee", () => {
  it("maps each tier to correct fee", () => {
    expect(calculateDynamicFee("trusted")).toBe(D2A_FEE_TRUSTED);
    expect(calculateDynamicFee("known")).toBe(D2A_FEE_KNOWN);
    expect(calculateDynamicFee("unknown")).toBe(D2A_FEE_UNKNOWN);
    expect(calculateDynamicFee("restricted")).toBe(Infinity);
  });

  it("restricted tier returns Infinity (fail-secure)", () => {
    const fee = calculateDynamicFee("restricted");
    expect(fee).toBe(Infinity);
    expect(Number.isFinite(fee)).toBe(false);
  });

  it("trusted fee is less than known fee", () => {
    expect(calculateDynamicFee("trusted")).toBeLessThan(calculateDynamicFee("known"));
  });

  it("known fee is less than unknown fee", () => {
    expect(calculateDynamicFee("known")).toBeLessThan(calculateDynamicFee("unknown"));
  });
});
