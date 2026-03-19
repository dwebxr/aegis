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
  _resetReputationCache,
  type PeerReputation,
} from "@/lib/d2a/reputation";

beforeEach(() => {
  localStorage.clear();
  _resetReputationCache();
});

describe("reputation — memory cache behavior", () => {
  it("returns same Map instance on repeated loadReputations calls", () => {
    const map1 = loadReputations();
    const map2 = loadReputations();
    expect(map1).toBe(map2);
  });

  it("cache updates after saveReputations", () => {
    const map = new Map<string, PeerReputation>();
    map.set("pk1", { pubkey: "pk1", useful: 10, slop: 0, score: 10, blocked: false, updatedAt: 1 });
    saveReputations(map);
    const loaded = loadReputations();
    expect(loaded.get("pk1")!.useful).toBe(10);
  });

  it("cache reset forces re-read from localStorage", () => {
    recordUseful("peer-x");
    const before = loadReputations().get("peer-x");
    expect(before).toBeDefined();

    _resetReputationCache();

    // After reset, should re-read from localStorage
    const after = loadReputations().get("peer-x");
    expect(after).toBeDefined();
    expect(after!.useful).toBe(1);
  });
});

describe("reputation — rapid successive operations", () => {
  it("interleaved useful/slop maintains correct counts", () => {
    // Simulate rapid alternating signals
    for (let i = 0; i < 10; i++) {
      if (i % 3 === 0) recordSlop("peer-rapid");
      else recordUseful("peer-rapid");
    }
    const rep = getReputation("peer-rapid")!;
    // 10 iterations: indices 0,3,6,9 → 4 slop; indices 1,2,4,5,7,8 → 6 useful
    expect(rep.useful).toBe(6);
    expect(rep.slop).toBe(4);
    expect(rep.score).toBe(6 - 4 * 3); // -6
    expect(rep.blocked).toBe(true);
  });

  it("many peers tracked simultaneously", () => {
    const peerCount = 50;
    for (let i = 0; i < peerCount; i++) {
      const pk = `peer-${i}`;
      recordUseful(pk);
      if (i % 5 === 0) recordSlop(pk);
    }

    const map = loadReputations();
    expect(map.size).toBe(peerCount);

    // Peers at indices 0,5,10,...45 have 1 useful + 1 slop → score = 1-3 = -2
    for (let i = 0; i < peerCount; i++) {
      const rep = map.get(`peer-${i}`)!;
      if (i % 5 === 0) {
        expect(rep.score).toBe(-2);
      } else {
        expect(rep.score).toBe(1);
      }
    }
  });
});

describe("reputation — serialization edge cases", () => {
  it("handles Map with empty string key", () => {
    const map = new Map<string, PeerReputation>();
    map.set("", { pubkey: "", useful: 1, slop: 0, score: 1, blocked: false, updatedAt: 1 });
    saveReputations(map);
    _resetReputationCache();
    const loaded = loadReputations();
    expect(loaded.get("")).toBeDefined();
    expect(loaded.get("")!.useful).toBe(1);
  });

  it("handles Map with unicode keys", () => {
    const pk = "日本語テスト";
    const map = new Map<string, PeerReputation>();
    map.set(pk, { pubkey: pk, useful: 3, slop: 1, score: 0, blocked: false, updatedAt: 1 });
    saveReputations(map);
    _resetReputationCache();
    const loaded = loadReputations();
    expect(loaded.get(pk)!.useful).toBe(3);
  });

  it("handles very large Map (1000 entries)", () => {
    const map = new Map<string, PeerReputation>();
    for (let i = 0; i < 1000; i++) {
      map.set(`pk-${i}`, { pubkey: `pk-${i}`, useful: i, slop: 0, score: i, blocked: false, updatedAt: Date.now() });
    }
    saveReputations(map);
    _resetReputationCache();
    const loaded = loadReputations();
    expect(loaded.size).toBe(1000);
    expect(loaded.get("pk-999")!.useful).toBe(999);
  });
});

describe("calculateEffectiveTrust — floating point precision", () => {
  it("handles very small wotScore", () => {
    const result = calculateEffectiveTrust(0.0001, 0);
    expect(result).toBeCloseTo(0.00006, 5);
  });

  it("handles fractional repScore", () => {
    // repScore 7.5 → normalized = 0.75 → 0 * 0.6 + 0.75 * 0.4 = 0.3
    expect(calculateEffectiveTrust(0, 7.5)).toBeCloseTo(0.3, 5);
  });

  it("both at midpoint", () => {
    // wot=0.5, rep=5 → normalize(5)=0.5 → 0.5*0.6 + 0.5*0.4 = 0.3 + 0.2 = 0.5
    expect(calculateEffectiveTrust(0.5, 5)).toBeCloseTo(0.5, 5);
  });
});

describe("reputation — recovery journey", () => {
  it("tracks full lifecycle: useful → slop → blocked → recovery → unblocked", () => {
    // Phase 1: Build positive reputation
    for (let i = 0; i < 3; i++) recordUseful("lifecycle");
    expect(getReputation("lifecycle")!.score).toBe(3);
    expect(isBlocked("lifecycle")).toBe(false);

    // Phase 2: Bad behavior triggers blocking
    for (let i = 0; i < 3; i++) recordSlop("lifecycle");
    // score = 3 - 9 = -6
    expect(getReputation("lifecycle")!.score).toBe(-6);
    expect(isBlocked("lifecycle")).toBe(true);

    // Phase 3: Recovery
    for (let i = 0; i < 5; i++) recordUseful("lifecycle");
    // score = 8 - 9 = -1
    expect(getReputation("lifecycle")!.score).toBe(-1);
    expect(isBlocked("lifecycle")).toBe(false);

    // Verify final counts
    const rep = getReputation("lifecycle")!;
    expect(rep.useful).toBe(8);
    expect(rep.slop).toBe(3);
  });
});
