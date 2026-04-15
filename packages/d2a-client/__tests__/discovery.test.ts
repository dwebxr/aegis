import { calculateResonance } from "../src/discovery";
import type { ResonancePrefs, AgentProfile } from "../src/types";

function prefs(map: Record<string, number>): ResonancePrefs {
  return { topicAffinities: map };
}
function profile(interests: string[]): Pick<AgentProfile, "interests"> {
  return { interests };
}

describe("calculateResonance — Jaccard similarity over high-affinity topics", () => {
  it("returns 0 when caller has no high-affinity topics", () => {
    expect(calculateResonance(prefs({ rust: 0.1 }), profile(["rust"]))).toBe(0);
  });

  it("returns 0 when peer has no interests", () => {
    expect(calculateResonance(prefs({ rust: 0.9 }), profile([]))).toBe(0);
  });

  it("returns 0 when sets are disjoint", () => {
    expect(calculateResonance(prefs({ rust: 0.9 }), profile(["python"]))).toBe(0);
  });

  it("returns 1 when sets are identical", () => {
    expect(calculateResonance(prefs({ rust: 0.9, ml: 0.9 }), profile(["rust", "ml"]))).toBe(1);
  });

  it("computes Jaccard correctly for partial overlap", () => {
    // myHigh = {rust, ml} (size 2), theirSet = {rust, python, go} (size 3)
    // overlap = 1 (rust). union = 3 + 2 - 1 = 4. result = 0.25.
    const r = calculateResonance(
      prefs({ rust: 0.9, ml: 0.9, low: 0.05 }),
      profile(["rust", "python", "go"]),
    );
    expect(r).toBeCloseTo(0.25, 5);
  });

  it("ignores topics below INTEREST_BROADCAST_THRESHOLD", () => {
    const r = calculateResonance(
      prefs({ rust: 0.9, low: 0.1 }),
      profile(["rust", "low"]),
    );
    // myHigh = {rust} (size 1), theirSet = {rust, low} (size 2), overlap = 1.
    // union = 2 + 1 - 1 = 2. result = 0.5.
    expect(r).toBeCloseTo(0.5, 5);
  });
});
