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

describe("calculateResonance — edge cases", () => {
  it("returns 0 when both sides are empty (union = 0 guard)", () => {
    const prefs = makeProfile({ topicAffinities: {} });
    const peer = makePeerProfile({ interests: [] });
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("returns 0 when all affinities are below 0.2 threshold", () => {
    const prefs = makeProfile({
      topicAffinities: { a: 0.19, b: 0.0, c: -0.5 },
    });
    const peer = makePeerProfile({ interests: ["a", "b", "c"] });
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("includes topic at exactly 0.2 threshold", () => {
    const prefs = makeProfile({
      topicAffinities: { "edge": 0.2 },
    });
    const peer = makePeerProfile({ interests: ["edge"] });
    expect(calculateResonance(prefs, peer)).toBe(1.0);
  });

  it("excludes topic at 0.19 (below threshold)", () => {
    const prefs = makeProfile({
      topicAffinities: { "below": 0.19 },
    });
    const peer = makePeerProfile({ interests: ["below"] });
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("Jaccard: partial overlap gives correct ratio", () => {
    // My topics: [a, b, c] (3), their topics: [b, c, d, e] (4)
    // Overlap: [b, c] (2), Union: 3 + 4 - 2 = 5
    // Jaccard = 2/5 = 0.4
    const prefs = makeProfile({
      topicAffinities: { a: 0.5, b: 0.5, c: 0.5 },
    });
    const peer = makePeerProfile({ interests: ["b", "c", "d", "e"] });
    expect(calculateResonance(prefs, peer)).toBeCloseTo(0.4);
  });

  it("handles large topic sets", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 100; i++) affinities[`topic-${i}`] = 0.5;
    const prefs = makeProfile({ topicAffinities: affinities });

    const interests = Array.from({ length: 100 }, (_, i) => `topic-${i + 50}`);
    const peer = makePeerProfile({ interests });

    // 50 overlap out of 150 union = 1/3
    expect(calculateResonance(prefs, peer)).toBeCloseTo(1 / 3);
  });

  it("handles duplicate topics in peer interests", () => {
    const prefs = makeProfile({
      topicAffinities: { "ai": 0.8 },
    });
    // Duplicate in interests (Set deduplicates)
    const peer = makePeerProfile({ interests: ["ai", "ai", "ai"] });
    // theirSet.size = 1, myHighTopics.length = 1, overlap = 1
    // union = 1 + 1 - 1 = 1, Jaccard = 1/1 = 1.0
    expect(calculateResonance(prefs, peer)).toBe(1.0);
  });

  it("negative affinity topics are excluded", () => {
    const prefs = makeProfile({
      topicAffinities: { "good": 0.8, "bad": -0.5 },
    });
    const peer = makePeerProfile({ interests: ["good", "bad"] });
    // Only "good" is high-affinity, overlap with peer = 1
    // union = 2 (peer) + 1 (my) - 1 (overlap) = 2
    expect(calculateResonance(prefs, peer)).toBe(0.5);
  });
});
