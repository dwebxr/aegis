// Jest worker serialization fix — BigInt has no toJSON by default
// eslint-disable-next-line no-extend-native
(BigInt.prototype as unknown as Record<string, unknown>).toJSON = function () { return this.toString(); };

/**
 * BigInt conversion edge-case tests for IC canister serialization.
 *
 * The ms→ns pattern `BigInt(Math.round(x)) * BigInt(1_000_000)` is replicated here
 * because the source functions are private to their React contexts.
 * Acceptable for a 1-line expression — the value is testing edge-case behavior
 * (float precision, NaN, roundtrip), not the import chain.
 */
function msToNanoseconds(ms: number): bigint {
  return BigInt(Math.round(ms)) * BigInt(1_000_000);
}

function msToNanosecondsOpt(ms: number | undefined | null): [] | [bigint] {
  return ms ? [BigInt(Math.round(ms)) * BigInt(1_000_000)] as [bigint] : [] as [];
}

function msToBigInt(ms: number): bigint {
  return BigInt(Math.round(ms));
}

function nanosecondsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

describe("msToNanoseconds — standard conversions", () => {
  it("converts Date.now() to nanoseconds", () => {
    const now = 1700000000000; // 2023-11-14
    const result = msToNanoseconds(now);
    expect(result).toBe(BigInt("1700000000000000000"));
  });

  it("converts 0 to 0n", () => {
    expect(msToNanoseconds(0)).toBe(0n);
  });

  it("converts 1 millisecond to 1_000_000 nanoseconds", () => {
    expect(msToNanoseconds(1)).toBe(1_000_000n);
  });

  it("converts a recent timestamp correctly", () => {
    const ts = 1770625773225; // 2026-ish
    const result = msToNanoseconds(ts);
    expect(result).toBe(BigInt(ts) * BigInt(1_000_000));
  });
});

describe("msToNanoseconds — the bug that Math.round fixes", () => {
  it("handles the exact floating-point error case: 1770625773225.9998", () => {
    // Production bug: JS floating point produces non-integer, BigInt() throws
    const problematic = 1770625773225.9998;
    expect(() => BigInt(problematic)).toThrow();
    expect(msToNanoseconds(problematic)).toBe(BigInt(1770625773226) * BigInt(1_000_000));
  });

  it("handles other floating-point imprecision values", () => {
    const imprecise = 1000000000000.3;
    expect(() => BigInt(imprecise)).toThrow();
    expect(msToNanoseconds(imprecise)).toBe(BigInt(1000000000000) * BigInt(1_000_000));
  });

  it("handles .5 rounding", () => {
    expect(msToNanoseconds(1000.5)).toBe(BigInt(1001) * BigInt(1_000_000));
    expect(msToNanoseconds(1001.5)).toBe(BigInt(1002) * BigInt(1_000_000));
  });

  it("handles .4999999999 — float64 precision limit at 1e12 magnitude", () => {
    // float64 stores 1000000000000.4999999999 as 1000000000001
    const val = 1000000000000.4999999999;
    expect(Math.round(val)).toBe(1000000000001);
    expect(msToNanoseconds(val)).toBe(BigInt(1000000000001) * BigInt(1_000_000));
  });
});

describe("msToNanoseconds — boundary values", () => {
  it("handles negative timestamp", () => {
    expect(msToNanoseconds(-1)).toBe(BigInt(-1) * BigInt(1_000_000));
  });

  it("handles very large timestamp (year 3000: ~32503680000000)", () => {
    const far = 32503680000000;
    const result = msToNanoseconds(far);
    expect(result).toBe(BigInt("32503680000000000000"));
  });

  it("handles Number.MAX_SAFE_INTEGER", () => {
    const result = msToNanoseconds(Number.MAX_SAFE_INTEGER);
    expect(result).toBe(BigInt(Number.MAX_SAFE_INTEGER) * BigInt(1_000_000));
  });

  it("handles small positive fractional", () => {
    expect(msToNanoseconds(0.1)).toBe(0n);
    expect(msToNanoseconds(0.6)).toBe(1_000_000n);
  });
});

describe("msToNanoseconds — NaN and Infinity guard", () => {
  it("NaN throws", () => {
    expect(() => msToNanoseconds(NaN)).toThrow();
  });

  it("Infinity throws", () => {
    expect(() => msToNanoseconds(Infinity)).toThrow();
  });

  it("-Infinity throws", () => {
    expect(() => msToNanoseconds(-Infinity)).toThrow();
  });
});

describe("msToNanosecondsOpt — optional validatedAt pattern", () => {
  it("returns single-element tuple for defined value", () => {
    const result = msToNanosecondsOpt(1700000000000);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(BigInt("1700000000000000000"));
  });

  it("returns empty array for undefined", () => {
    expect(msToNanosecondsOpt(undefined)).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(msToNanosecondsOpt(null)).toEqual([]);
  });

  it("returns empty array for 0 (falsy — matches Candid opt pattern)", () => {
    expect(msToNanosecondsOpt(0)).toEqual([]);
  });

  it("handles floating-point validatedAt", () => {
    const result = msToNanosecondsOpt(1700000000000.7);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(BigInt(1700000000001) * BigInt(1_000_000));
  });
});

describe("msToBigInt — preference lastUpdated (no nanosecond multiplier)", () => {
  it("converts integer timestamp directly", () => {
    expect(msToBigInt(1700000000000)).toBe(BigInt(1700000000000));
  });

  it("rounds floating-point timestamp", () => {
    expect(msToBigInt(1700000000000.9998)).toBe(BigInt(1700000000001));
  });

  it("handles 0", () => {
    expect(msToBigInt(0)).toBe(0n);
  });
});

describe("nanosecondsToMs roundtrip — IC ↔ JS consistency", () => {
  it("roundtrip: ms → ns → ms preserves value for integer timestamps", () => {
    const original = 1700000000000;
    const ns = msToNanoseconds(original);
    const restored = nanosecondsToMs(ns);
    expect(restored).toBe(original);
  });

  it("roundtrip: ms → ns → ms preserves rounded value for fractional timestamps", () => {
    const original = 1700000000000.7;
    const ns = msToNanoseconds(original);
    const restored = nanosecondsToMs(ns);
    expect(restored).toBe(1700000000001);
  });

  it("roundtrip: large timestamps (2026-era)", () => {
    const original = 1770625773225;
    const ns = msToNanoseconds(original);
    const restored = nanosecondsToMs(ns);
    expect(restored).toBe(original);
  });

  it("roundtrip with the exact bug timestamp — sub-ms precision loss from Number(bigint)", () => {
    const original = 1770625773225.9998;
    const ns = msToNanoseconds(original);
    const restored = nanosecondsToMs(ns);
    // float64 imprecision at this magnitude, error < 0.001ms
    expect(restored).toBeCloseTo(1770625773226, 0);
  });

  it("multiple roundtrips are idempotent", () => {
    const original = 1700000000000;
    let value = original;
    for (let i = 0; i < 10; i++) {
      const ns = msToNanoseconds(value);
      value = nanosecondsToMs(ns);
    }
    expect(value).toBe(original);
  });
});

describe("savedToIC / icToSaved conversion parity", () => {
  function savedToICCreatedAt(createdAt: number): bigint {
    return BigInt(Math.round(createdAt)) * BigInt(1_000_000);
  }

  function icToSavedCreatedAt(createdAtNs: bigint): number {
    return Number(createdAtNs) / 1_000_000;
  }

  it("source created today roundtrips with sub-ms precision loss", () => {
    const ts = Date.now();
    const roundtripped = icToSavedCreatedAt(savedToICCreatedAt(ts));
    expect(roundtripped).toBeCloseTo(ts, 0);
  });

  it("source created at epoch roundtrips correctly", () => {
    expect(icToSavedCreatedAt(savedToICCreatedAt(0))).toBe(0);
  });

  it("source with fractional createdAt rounds correctly", () => {
    const ts = 1700000000000.3;
    const roundtripped = icToSavedCreatedAt(savedToICCreatedAt(ts));
    expect(roundtripped).toBe(1700000000000);
  });
});

describe("contentToIC evaluation field correctness", () => {
  function toICScores(scores: { originality: number; insight: number; credibility: number; composite: number }) {
    return {
      originality: Math.round(scores.originality),
      insight: Math.round(scores.insight),
      credibility: Math.round(scores.credibility),
      compositeScore: scores.composite,
    };
  }

  it("rounds sub-scores to integers", () => {
    const result = toICScores({ originality: 7.8, insight: 6.3, credibility: 8.9, composite: 7.67 });
    expect(result.originality).toBe(8);
    expect(result.insight).toBe(6);
    expect(result.credibility).toBe(9);
    expect(result.compositeScore).toBe(7.67);
  });

  it("handles perfect scores", () => {
    const result = toICScores({ originality: 10, insight: 10, credibility: 10, composite: 10 });
    expect(result.originality).toBe(10);
    expect(result.compositeScore).toBe(10);
  });

  it("handles zero scores", () => {
    const result = toICScores({ originality: 0, insight: 0, credibility: 0, composite: 0 });
    expect(result.originality).toBe(0);
    expect(result.compositeScore).toBe(0);
  });

  it("rounds .5 scores up", () => {
    const result = toICScores({ originality: 7.5, insight: 8.5, credibility: 9.5, composite: 8.5 });
    expect(result.originality).toBe(8);
    expect(result.insight).toBe(9);
    expect(result.credibility).toBe(10);
  });
});
