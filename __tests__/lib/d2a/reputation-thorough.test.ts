/**
 * Thorough tests for D2A peer reputation — scoring math, blocking threshold,
 * trust tier boundaries, dynamic fees, and persistence.
 */
import {
  recordUseful,
  recordSlop,
  isBlocked,
  getReputation,
  loadReputations,
  saveReputations,
  calculateEffectiveTrust,
  getTrustTier,
  calculateDynamicFee,
  type PeerReputation,
} from "@/lib/d2a/reputation";
import { D2A_FEE_TRUSTED, D2A_FEE_KNOWN, D2A_FEE_UNKNOWN } from "@/lib/agent/protocol";

const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    writable: true,
  });
});
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

describe("reputation scoring formula: score = useful - slop * 3", () => {
  it("new peer starts at score 0", () => {
    const rep = recordUseful("peer-a");
    // After 1 useful: 1 - 0*3 = 1
    expect(rep.score).toBe(1);
    expect(rep.useful).toBe(1);
    expect(rep.slop).toBe(0);
  });

  it("single slop gives score -3", () => {
    const rep = recordSlop("peer-b");
    expect(rep.score).toBe(-3);
    expect(rep.slop).toBe(1);
  });

  it("2 useful + 1 slop = 2 - 3 = -1", () => {
    recordUseful("peer-c");
    recordUseful("peer-c");
    const rep = recordSlop("peer-c");
    expect(rep.score).toBe(-1);
  });

  it("5 useful + 2 slop = 5 - 6 = -1", () => {
    for (let i = 0; i < 5; i++) recordUseful("peer-d");
    recordSlop("peer-d");
    const rep = recordSlop("peer-d");
    expect(rep.score).toBe(-1);
  });
});

describe("blocking threshold: score <= -5", () => {
  it("score -4 is NOT blocked", () => {
    // 2 useful + 2 slop = 2 - 6 = -4
    recordUseful("peer-e");
    recordUseful("peer-e");
    recordSlop("peer-e");
    recordSlop("peer-e");
    expect(isBlocked("peer-e")).toBe(false);
  });

  it("score -5 IS blocked", () => {
    // 1 useful + 2 slop = 1 - 6 = -5
    recordUseful("peer-f");
    recordSlop("peer-f");
    recordSlop("peer-f");
    expect(isBlocked("peer-f")).toBe(true);
  });

  it("recovery from blocked: useful marks improve score", () => {
    recordSlop("peer-g");
    recordSlop("peer-g");
    expect(isBlocked("peer-g")).toBe(true); // score = -6

    // Add 4 useful: 4 - 6 = -2 → no longer blocked
    for (let i = 0; i < 4; i++) recordUseful("peer-g");
    expect(isBlocked("peer-g")).toBe(false);
    expect(getReputation("peer-g")!.score).toBe(-2);
  });

  it("unknown peer is not blocked", () => {
    expect(isBlocked("nonexistent")).toBe(false);
  });
});

describe("persistence round-trip", () => {
  it("survives save/load cycle", () => {
    recordUseful("persist-peer");
    recordUseful("persist-peer");
    recordSlop("persist-peer");

    const loaded = loadReputations();
    const rep = loaded.get("persist-peer");
    expect(rep).toBeDefined();
    expect(rep!.useful).toBe(2);
    expect(rep!.slop).toBe(1);
    expect(rep!.score).toBe(-1);
  });

  it("handles corrupted data gracefully (wrong version)", () => {
    store["aegis-d2a-reputation"] = JSON.stringify({ version: 2, peers: [] });
    const map = loadReputations();
    expect(map.size).toBe(0);
  });

  it("handles corrupted data gracefully (not an object)", () => {
    store["aegis-d2a-reputation"] = "\"just a string\"";
    const map = loadReputations();
    expect(map.size).toBe(0);
  });

  it("handles missing peers array", () => {
    store["aegis-d2a-reputation"] = JSON.stringify({ version: 1 });
    const map = loadReputations();
    expect(map.size).toBe(0);
  });
});

describe("calculateEffectiveTrust: 60% WoT + 40% normalized rep", () => {
  it("pure WoT (rep=0) gives 60% of wotScore", () => {
    expect(calculateEffectiveTrust(1.0, 0)).toBeCloseTo(0.6, 2);
  });

  it("max rep (10) + max WoT (1.0) = 1.0", () => {
    // normalizeRepScore(10) = 1.0, so 1.0*0.6 + 1.0*0.4 = 1.0
    expect(calculateEffectiveTrust(1.0, 10)).toBeCloseTo(1.0, 2);
  });

  it("negative rep is clamped to 0", () => {
    // normalizeRepScore(-5) = max(0, min(1, -5/10)) = 0
    expect(calculateEffectiveTrust(0.5, -5)).toBeCloseTo(0.3, 2);
  });

  it("very high rep is clamped to 1", () => {
    // normalizeRepScore(100) = max(0, min(1, 100/10)) = 1
    expect(calculateEffectiveTrust(0, 100)).toBeCloseTo(0.4, 2);
  });

  it("zero WoT + zero rep = 0", () => {
    expect(calculateEffectiveTrust(0, 0)).toBe(0);
  });
});

describe("getTrustTier boundary conditions", () => {
  it("0.8 exactly → trusted", () => {
    expect(getTrustTier(0.8)).toBe("trusted");
  });

  it("0.799 → known", () => {
    expect(getTrustTier(0.799)).toBe("known");
  });

  it("0.4 exactly → known", () => {
    expect(getTrustTier(0.4)).toBe("known");
  });

  it("0.399 → unknown", () => {
    expect(getTrustTier(0.399)).toBe("unknown");
  });

  it("0 exactly → unknown", () => {
    expect(getTrustTier(0)).toBe("unknown");
  });

  it("negative → restricted", () => {
    expect(getTrustTier(-0.1)).toBe("restricted");
  });

  it("1.0 → trusted", () => {
    expect(getTrustTier(1.0)).toBe("trusted");
  });
});

describe("calculateDynamicFee", () => {
  it("trusted → free (0)", () => {
    expect(calculateDynamicFee("trusted")).toBe(D2A_FEE_TRUSTED);
    expect(calculateDynamicFee("trusted")).toBe(0);
  });

  it("known → 0.001 ICP", () => {
    expect(calculateDynamicFee("known")).toBe(D2A_FEE_KNOWN);
    expect(calculateDynamicFee("known")).toBe(100_000);
  });

  it("unknown → 0.002 ICP", () => {
    expect(calculateDynamicFee("unknown")).toBe(D2A_FEE_UNKNOWN);
    expect(calculateDynamicFee("unknown")).toBe(200_000);
  });

  it("restricted → 0 (can't transact)", () => {
    expect(calculateDynamicFee("restricted")).toBe(0);
  });
});

describe("concurrent updates to same peer", () => {
  it("sequential useful + slop keeps correct counts", () => {
    recordUseful("peer-seq");
    recordUseful("peer-seq");
    recordUseful("peer-seq");
    recordSlop("peer-seq");
    recordSlop("peer-seq");

    const rep = getReputation("peer-seq")!;
    expect(rep.useful).toBe(3);
    expect(rep.slop).toBe(2);
    expect(rep.score).toBe(3 - 2 * 3); // -3
  });
});
