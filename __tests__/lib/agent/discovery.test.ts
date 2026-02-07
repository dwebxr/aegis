import { calculateResonance } from "@/lib/agent/discovery";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { AgentProfile } from "@/lib/agent/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

function makeProfile(overrides: Partial<UserPreferenceProfile> = {}): UserPreferenceProfile {
  return { ...createEmptyProfile("test"), ...overrides };
}

function makePeerProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    nostrPubkey: "peer-pubkey",
    interests: [],
    capacity: 5,
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe("calculateResonance", () => {
  it("returns 0 when user has no high-affinity topics", () => {
    const prefs = makeProfile({
      topicAffinities: { "low": 0.1, "medium": 0.2 }, // all below 0.3
    });
    const peer = makePeerProfile({ interests: ["low", "medium"] });
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("returns 0 when peer has no interests", () => {
    const prefs = makeProfile({
      topicAffinities: { "ai": 0.8 },
    });
    const peer = makePeerProfile({ interests: [] });
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("returns 0 when there is no topic overlap", () => {
    const prefs = makeProfile({
      topicAffinities: { "ai": 0.8, "ml": 0.5 },
    });
    const peer = makePeerProfile({ interests: ["crypto", "defi"] });
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("returns 1.0 for perfect overlap (same topics)", () => {
    const prefs = makeProfile({
      topicAffinities: { "ai": 0.8, "ml": 0.5 },
    });
    const peer = makePeerProfile({ interests: ["ai", "ml"] });
    expect(calculateResonance(prefs, peer)).toBe(1.0);
  });

  it("returns 1.0 for single overlapping topic", () => {
    const prefs = makeProfile({
      topicAffinities: { "ai": 0.5 },
    });
    const peer = makePeerProfile({ interests: ["ai"] });
    expect(calculateResonance(prefs, peer)).toBe(1.0);
  });

  it("calculates Jaccard similarity correctly for partial overlap", () => {
    const prefs = makeProfile({
      topicAffinities: { "ai": 0.8, "ml": 0.5 },
    });
    const peer = makePeerProfile({ interests: ["ai", "crypto"] });
    // My high topics: ["ai", "ml"]
    // Their interests: ["ai", "crypto"]
    // Overlap: 1 (ai)
    // Union: {ai, ml, crypto} = 3
    // Jaccard: 1/3
    expect(calculateResonance(prefs, peer)).toBeCloseTo(1 / 3);
  });

  it("only considers topics with affinity >= 0.3 from user", () => {
    const prefs = makeProfile({
      topicAffinities: {
        "high": 0.8,    // included
        "medium": 0.3,  // included (boundary)
        "low": 0.29,    // excluded
        "negative": -0.5, // excluded
      },
    });
    const peer = makePeerProfile({
      interests: ["high", "medium", "low", "negative"],
    });
    // My high topics: ["high", "medium"]
    // Overlap: 2
    // Union: {high, medium, low, negative} = 4
    // Jaccard: 2/4 = 0.5
    expect(calculateResonance(prefs, peer)).toBeCloseTo(0.5);
  });

  it("handles large topic sets", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 50; i++) affinities[`topic-${i}`] = 0.5;
    const prefs = makeProfile({ topicAffinities: affinities });
    const peer = makePeerProfile({
      interests: Array.from({ length: 50 }, (_, i) => `topic-${i}`),
    });
    expect(calculateResonance(prefs, peer)).toBe(1.0);
  });

  it("returns value between 0 and 1", () => {
    const prefs = makeProfile({
      topicAffinities: { "a": 0.5, "b": 0.4, "c": 0.6 },
    });
    const peer = makePeerProfile({ interests: ["a", "d", "e"] });
    const result = calculateResonance(prefs, peer);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
