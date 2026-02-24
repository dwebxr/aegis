/**
 * @jest-environment jsdom
 */
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
} from "@/lib/d2a/reputation";
import { D2A_FEE_TRUSTED, D2A_FEE_KNOWN, D2A_FEE_UNKNOWN } from "@/lib/agent/protocol";

const TEST_PK = "abc123deadbeef";
const TEST_PK2 = "def456cafebabe";

beforeEach(() => {
  localStorage.clear();
  _resetReputationCache();
});

describe("loadReputations / saveReputations", () => {
  it("returns empty map when nothing stored", () => {
    const map = loadReputations();
    expect(map.size).toBe(0);
  });

  it("round-trips a map through localStorage", () => {
    const map = new Map();
    map.set(TEST_PK, {
      pubkey: TEST_PK,
      useful: 5,
      slop: 1,
      score: 2,
      blocked: false,
      updatedAt: 1000,
    });
    saveReputations(map);
    const loaded = loadReputations();
    expect(loaded.size).toBe(1);
    expect(loaded.get(TEST_PK)!.useful).toBe(5);
    expect(loaded.get(TEST_PK)!.slop).toBe(1);
    expect(loaded.get(TEST_PK)!.score).toBe(2);
  });

  it("returns empty map for corrupted localStorage", () => {
    localStorage.setItem("aegis-d2a-reputation", "{invalid json");
    const map = loadReputations();
    expect(map.size).toBe(0);
    // Corrupted data should be cleared
    expect(localStorage.getItem("aegis-d2a-reputation")).toBeNull();
  });
});

describe("recordUseful", () => {
  it("creates new reputation on first useful", () => {
    const rep = recordUseful(TEST_PK);
    expect(rep.useful).toBe(1);
    expect(rep.slop).toBe(0);
    expect(rep.score).toBe(1);
    expect(rep.blocked).toBe(false);
  });

  it("increments useful count", () => {
    recordUseful(TEST_PK);
    recordUseful(TEST_PK);
    const rep = recordUseful(TEST_PK);
    expect(rep.useful).toBe(3);
    expect(rep.score).toBe(3);
  });

  it("persists to localStorage", () => {
    recordUseful(TEST_PK);
    const loaded = loadReputations();
    expect(loaded.get(TEST_PK)!.useful).toBe(1);
  });
});

describe("recordSlop", () => {
  it("creates new reputation with negative score", () => {
    const rep = recordSlop(TEST_PK);
    expect(rep.slop).toBe(1);
    expect(rep.useful).toBe(0);
    expect(rep.score).toBe(-3);
  });

  it("auto-blocks at score <= -5", () => {
    recordSlop(TEST_PK); // score = -3
    const rep = recordSlop(TEST_PK); // score = -6
    expect(rep.score).toBe(-6);
    expect(rep.blocked).toBe(true);
  });

  it("useful can offset slop", () => {
    // 4 useful = +4, 1 slop = -3, score = 1
    recordUseful(TEST_PK);
    recordUseful(TEST_PK);
    recordUseful(TEST_PK);
    recordUseful(TEST_PK);
    const rep = recordSlop(TEST_PK);
    expect(rep.score).toBe(1);
    expect(rep.blocked).toBe(false);
  });
});

describe("isBlocked", () => {
  it("returns false for unknown peer", () => {
    expect(isBlocked(TEST_PK)).toBe(false);
  });

  it("returns true for blocked peer", () => {
    recordSlop(TEST_PK);
    recordSlop(TEST_PK);
    expect(isBlocked(TEST_PK)).toBe(true);
  });
});

describe("getReputation", () => {
  it("returns undefined for unknown peer", () => {
    expect(getReputation(TEST_PK)).toBeUndefined();
  });

  it("returns reputation for tracked peer", () => {
    recordUseful(TEST_PK);
    const rep = getReputation(TEST_PK);
    expect(rep).toBeDefined();
    expect(rep!.pubkey).toBe(TEST_PK);
  });
});

describe("multiple peers", () => {
  it("tracks peers independently", () => {
    recordUseful(TEST_PK);
    recordSlop(TEST_PK2);
    expect(getReputation(TEST_PK)!.score).toBe(1);
    expect(getReputation(TEST_PK2)!.score).toBe(-3);
  });
});

describe("calculateEffectiveTrust", () => {
  it("returns wot-weighted result for neutral reputation", () => {
    // wotScore=0.5 * 0.6 + normalize(0) * 0.4 = 0.3
    expect(calculateEffectiveTrust(0.5, 0)).toBe(0.3);
  });

  it("returns 1.0 for perfect wot + perfect reputation", () => {
    // wot=1.0 * 0.6 + normalize(10) * 0.4 = 0.6 + 0.4 = 1.0
    expect(calculateEffectiveTrust(1.0, 10)).toBe(1.0);
  });

  it("clamps negative reputation to 0", () => {
    // wot=0.0 * 0.6 + normalize(-5) * 0.4 = 0 + 0 = 0
    expect(calculateEffectiveTrust(0, -5)).toBe(0);
  });

  it("clamps high reputation to 1", () => {
    // wot=0.0 * 0.6 + normalize(20) * 0.4 = 0 + 0.4 = 0.4
    expect(calculateEffectiveTrust(0, 20)).toBeCloseTo(0.4);
  });
});

describe("getTrustTier", () => {
  it("returns 'trusted' for >= 0.8", () => {
    expect(getTrustTier(0.8)).toBe("trusted");
    expect(getTrustTier(1.0)).toBe("trusted");
  });

  it("returns 'known' for >= 0.4", () => {
    expect(getTrustTier(0.4)).toBe("known");
    expect(getTrustTier(0.79)).toBe("known");
  });

  it("returns 'unknown' for >= 0", () => {
    expect(getTrustTier(0)).toBe("unknown");
    expect(getTrustTier(0.39)).toBe("unknown");
  });

  it("returns 'restricted' for < 0", () => {
    expect(getTrustTier(-0.1)).toBe("restricted");
    expect(getTrustTier(-1)).toBe("restricted");
  });
});

describe("calculateDynamicFee", () => {
  it("returns correct fee for each tier", () => {
    expect(calculateDynamicFee("trusted")).toBe(D2A_FEE_TRUSTED);
    expect(calculateDynamicFee("known")).toBe(D2A_FEE_KNOWN);
    expect(calculateDynamicFee("unknown")).toBe(D2A_FEE_UNKNOWN);
    expect(calculateDynamicFee("restricted")).toBe(0);
  });

  it("trusted fee is lowest", () => {
    expect(D2A_FEE_TRUSTED).toBeLessThan(D2A_FEE_KNOWN);
    expect(D2A_FEE_KNOWN).toBeLessThan(D2A_FEE_UNKNOWN);
  });
});

describe("saveReputations — error handling", () => {
  it("does not throw on QuotaExceededError and logs warning", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    const map = new Map();
    map.set(TEST_PK, {
      pubkey: TEST_PK, useful: 1, slop: 0, score: 1, blocked: false, updatedAt: 1000,
    });

    expect(() => saveReputations(map)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      "[d2a-reputation] Failed to persist reputations:",
      expect.any(DOMException),
    );

    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("recordUseful does not throw when localStorage save fails", () => {
    // Pre-seed data so loadReputations in getOrCreate() works before setItem breaks
    recordUseful(TEST_PK);

    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    jest.spyOn(console, "warn").mockImplementation();

    expect(() => recordUseful(TEST_PK)).not.toThrow();

    setItemSpy.mockRestore();
    jest.restoreAllMocks();
  });
});

// ─── Edge cases ───

describe("loadReputations — malformed data", () => {
  it("returns empty map when version is not 1", () => {
    localStorage.setItem("aegis-d2a-reputation", JSON.stringify({ version: 2, peers: [] }));
    expect(loadReputations().size).toBe(0);
  });

  it("returns empty map when peers field is not an array", () => {
    localStorage.setItem("aegis-d2a-reputation", JSON.stringify({ version: 1, peers: "bad" }));
    expect(loadReputations().size).toBe(0);
  });
});

describe("recordSlop — exact blocking boundary", () => {
  it("score exactly -5 is blocked", () => {
    // 5 useful = +5, 1 useful + 2 slop: useful=5+1=6, slop=0+2=2, score = 6 - 2*3 = 0
    // Actually let's be precise: score = useful - slop * 3
    // We want score = -5 exactly: 0 useful, slop such that 0 - slop*3 = -5 → not integer
    // Nearest: useful=1, slop=2 → score = 1 - 6 = -5
    recordUseful(TEST_PK);
    recordSlop(TEST_PK);
    const rep = recordSlop(TEST_PK);
    expect(rep.score).toBe(1 - 2 * 3); // -5
    expect(rep.blocked).toBe(true);
  });

  it("score -4 is not blocked", () => {
    // useful=2, slop=2 → score = 2 - 6 = -4
    recordUseful(TEST_PK);
    recordUseful(TEST_PK);
    recordSlop(TEST_PK);
    const rep = recordSlop(TEST_PK);
    expect(rep.score).toBe(-4);
    expect(rep.blocked).toBe(false);
  });

  it("blocked peer can recover with enough useful signals", () => {
    recordSlop(TEST_PK);
    recordSlop(TEST_PK); // score = -6, blocked
    expect(isBlocked(TEST_PK)).toBe(true);

    // Add useful to bring score to -5+1 = still blocked (-5)
    recordUseful(TEST_PK); // useful=1, slop=2, score = 1-6 = -5, blocked
    expect(isBlocked(TEST_PK)).toBe(true);

    recordUseful(TEST_PK); // useful=2, slop=2, score = 2-6 = -4, unblocked
    expect(isBlocked(TEST_PK)).toBe(false);
  });
});

describe("getTrustTier — exact boundaries", () => {
  it("0.7999 is known, not trusted", () => {
    expect(getTrustTier(0.7999)).toBe("known");
  });

  it("0.3999 is unknown, not known", () => {
    expect(getTrustTier(0.3999)).toBe("unknown");
  });

  it("-0.0001 is restricted", () => {
    expect(getTrustTier(-0.0001)).toBe("restricted");
  });
});

describe("calculateEffectiveTrust — edge values", () => {
  it("both zero returns zero", () => {
    expect(calculateEffectiveTrust(0, 0)).toBe(0);
  });

  it("wot=1 rep=-100 still yields 0.6 (rep clamped to 0)", () => {
    // normalize(-100) = max(0, min(1, -10)) = 0
    // effective = 1.0 * 0.6 + 0 * 0.4 = 0.6
    expect(calculateEffectiveTrust(1.0, -100)).toBe(0.6);
  });

  it("wot=0 rep=5 yields mid-range known", () => {
    // normalize(5) = 0.5, effective = 0 + 0.5 * 0.4 = 0.2
    expect(calculateEffectiveTrust(0, 5)).toBeCloseTo(0.2);
  });
});

describe("reputation updatedAt tracking", () => {
  it("updatedAt advances on successive operations", () => {
    const rep1 = recordUseful(TEST_PK);
    const t1 = rep1.updatedAt;
    // Small delay not needed — Date.now() may be same ms, but >= is valid
    const rep2 = recordSlop(TEST_PK);
    expect(rep2.updatedAt).toBeGreaterThanOrEqual(t1);
  });
});
