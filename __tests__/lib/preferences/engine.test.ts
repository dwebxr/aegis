import { learn, getContext, hasEnoughData } from "@/lib/preferences/engine";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

function makeProfile(overrides: Partial<UserPreferenceProfile> = {}): UserPreferenceProfile {
  return { ...createEmptyProfile("test"), ...overrides };
}

describe("learn", () => {
  describe("topic affinities", () => {
    it("increases topic affinity on validate (+0.1)", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "validate",
        topics: ["ai"],
        author: "alice",
        composite: 7,
        verdict: "quality",
      });
      expect(next.topicAffinities["ai"]).toBeCloseTo(0.1);
    });

    it("decreases topic affinity on flag (-0.05)", () => {
      const profile = makeProfile({ topicAffinities: { "crypto": 0.5 } });
      const next = learn(profile, {
        action: "flag",
        topics: ["crypto"],
        author: "bob",
        composite: 3,
        verdict: "slop",
      });
      expect(next.topicAffinities["crypto"]).toBeCloseTo(0.45);
    });

    it("handles multiple topics in one event", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "validate",
        topics: ["ai", "ml", "transformers"],
        author: "alice",
        composite: 7,
        verdict: "quality",
      });
      expect(next.topicAffinities["ai"]).toBeCloseTo(0.1);
      expect(next.topicAffinities["ml"]).toBeCloseTo(0.1);
      expect(next.topicAffinities["transformers"]).toBeCloseTo(0.1);
    });

    it("clamps topic affinity at +1.0 cap", () => {
      const profile = makeProfile({ topicAffinities: { "ai": 0.95 } });
      const next = learn(profile, {
        action: "validate",
        topics: ["ai"],
        author: "alice",
        composite: 8,
        verdict: "quality",
      });
      expect(next.topicAffinities["ai"]).toBe(1.0);
    });

    it("clamps topic affinity at -1.0 floor", () => {
      const profile = makeProfile({ topicAffinities: { "spam": -0.98 } });
      const next = learn(profile, {
        action: "flag",
        topics: ["spam"],
        author: "spammer",
        composite: 2,
        verdict: "slop",
      });
      expect(next.topicAffinities["spam"]).toBe(-1.0);
    });

    it("initializes unknown topic from zero", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "flag",
        topics: ["newTopic"],
        author: "x",
        composite: 2,
        verdict: "slop",
      });
      expect(next.topicAffinities["newTopic"]).toBeCloseTo(-0.05);
    });
  });

  describe("author trust", () => {
    it("increases trust on validate (+0.2)", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "validate",
        topics: [],
        author: "goodAuthor",
        composite: 8,
        verdict: "quality",
      });
      expect(next.authorTrust["goodAuthor"].trust).toBeCloseTo(0.2);
      expect(next.authorTrust["goodAuthor"].validates).toBe(1);
      expect(next.authorTrust["goodAuthor"].flags).toBe(0);
    });

    it("decreases trust on flag (-0.3)", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "flag",
        topics: [],
        author: "badAuthor",
        composite: 2,
        verdict: "slop",
      });
      expect(next.authorTrust["badAuthor"].trust).toBeCloseTo(-0.3);
      expect(next.authorTrust["badAuthor"].flags).toBe(1);
    });

    it("accumulates across multiple events", () => {
      let profile = makeProfile();
      profile = learn(profile, { action: "validate", topics: [], author: "alice", composite: 7, verdict: "quality" });
      profile = learn(profile, { action: "validate", topics: [], author: "alice", composite: 8, verdict: "quality" });
      expect(profile.authorTrust["alice"].trust).toBeCloseTo(0.4);
      expect(profile.authorTrust["alice"].validates).toBe(2);
    });

    it("clamps trust at boundaries", () => {
      const profile = makeProfile({
        authorTrust: { "max": { validates: 10, flags: 0, trust: 0.9 } },
      });
      const next = learn(profile, {
        action: "validate",
        topics: [],
        author: "max",
        composite: 8,
        verdict: "quality",
      });
      expect(next.authorTrust["max"].trust).toBe(1.0);
    });

    it("does not update trust when author is empty string", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "validate",
        topics: ["ai"],
        author: "",
        composite: 8,
        verdict: "quality",
      });
      expect(Object.keys(next.authorTrust)).toHaveLength(0);
    });
  });

  describe("quality threshold calibration", () => {
    it("lowers threshold on borderline validate (score 3.5-4.5)", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "validate",
        topics: [],
        author: "a",
        composite: 4.0, // borderline
        verdict: "quality",
      });
      expect(next.calibration.qualityThreshold).toBeCloseTo(3.95);
    });

    it("does NOT lower threshold for non-borderline validate", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "validate",
        topics: [],
        author: "a",
        composite: 8.0, // not borderline
        verdict: "quality",
      });
      expect(next.calibration.qualityThreshold).toBe(4.0);
    });

    it("raises threshold when quality-judged content is flagged", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "flag",
        topics: [],
        author: "a",
        composite: 6.0,
        verdict: "quality", // AI said quality, user said slop
      });
      expect(next.calibration.qualityThreshold).toBeCloseTo(4.1);
    });

    it("does NOT raise threshold when slop-judged content is flagged", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "flag",
        topics: [],
        author: "a",
        composite: 2.0,
        verdict: "slop",
      });
      expect(next.calibration.qualityThreshold).toBe(4.0);
    });

    it("clamps threshold minimum at 1", () => {
      const profile = makeProfile();
      profile.calibration.qualityThreshold = 1.0;
      const next = learn(profile, {
        action: "validate",
        topics: [],
        author: "a",
        composite: 4.0,
        verdict: "quality",
      });
      expect(next.calibration.qualityThreshold).toBe(1.0);
    });

    it("clamps threshold maximum at 9", () => {
      const profile = makeProfile();
      profile.calibration.qualityThreshold = 8.95;
      const next = learn(profile, {
        action: "flag",
        topics: [],
        author: "a",
        composite: 6.0,
        verdict: "quality",
      });
      expect(next.calibration.qualityThreshold).toBe(9.0);
    });
  });

  describe("counters", () => {
    it("increments totalValidated on validate", () => {
      const profile = makeProfile();
      const next = learn(profile, { action: "validate", topics: [], author: "a", composite: 7, verdict: "quality" });
      expect(next.totalValidated).toBe(1);
      expect(next.totalFlagged).toBe(0);
    });

    it("increments totalFlagged on flag", () => {
      const profile = makeProfile();
      const next = learn(profile, { action: "flag", topics: [], author: "a", composite: 2, verdict: "slop" });
      expect(next.totalFlagged).toBe(1);
      expect(next.totalValidated).toBe(0);
    });
  });

  describe("recent topics sliding window", () => {
    it("appends topics to recentTopics", () => {
      const profile = makeProfile();
      const next = learn(profile, {
        action: "validate",
        topics: ["ai", "ml"],
        author: "a",
        composite: 7,
        verdict: "quality",
      });
      expect(next.recentTopics).toHaveLength(2);
      expect(next.recentTopics.map(rt => rt.topic)).toEqual(["ai", "ml"]);
    });

    it("caps recentTopics at 50, keeping most recent", () => {
      const profile = makeProfile({
        recentTopics: Array.from({ length: 49 }, (_, i) => ({
          topic: `topic-${i}`,
          timestamp: Date.now() - (49 - i) * 1000,
          weight: 1,
        })),
      });
      const next = learn(profile, {
        action: "validate",
        topics: ["new1", "new2"],
        author: "a",
        composite: 7,
        verdict: "quality",
      });
      // 49 + 2 = 51 → trimmed to 50
      expect(next.recentTopics).toHaveLength(50);
      // The newest topics should survive
      expect(next.recentTopics.some(rt => rt.topic === "new1")).toBe(true);
      expect(next.recentTopics.some(rt => rt.topic === "new2")).toBe(true);
    });
  });

  describe("immutability", () => {
    it("does not mutate the original profile", () => {
      const profile = makeProfile({ topicAffinities: { "ai": 0.5 } });
      const original = JSON.parse(JSON.stringify(profile));
      learn(profile, {
        action: "validate",
        topics: ["ai"],
        author: "a",
        composite: 7,
        verdict: "quality",
      });
      expect(profile).toEqual(original);
    });
  });
});

describe("getContext", () => {
  it("extracts high affinity topics (>= 0.3)", () => {
    const profile = makeProfile({
      topicAffinities: { "ai": 0.8, "ml": 0.5, "crypto": 0.1, "memes": -0.3 },
    });
    const ctx = getContext(profile);
    expect(ctx.highAffinityTopics).toContain("ai");
    expect(ctx.highAffinityTopics).toContain("ml");
    expect(ctx.highAffinityTopics).not.toContain("crypto");
    expect(ctx.highAffinityTopics).not.toContain("memes");
  });

  it("sorts high affinity topics by value descending", () => {
    const profile = makeProfile({
      topicAffinities: { "ai": 0.5, "security": 0.9, "ml": 0.3 },
    });
    const ctx = getContext(profile);
    expect(ctx.highAffinityTopics).toEqual(["security", "ai", "ml"]);
  });

  it("limits high affinity topics to 10", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 15; i++) {
      affinities[`topic-${i}`] = 0.3 + (i * 0.01);
    }
    const profile = makeProfile({ topicAffinities: affinities });
    const ctx = getContext(profile);
    expect(ctx.highAffinityTopics).toHaveLength(10);
  });

  it("extracts low affinity topics (<= -0.2)", () => {
    const profile = makeProfile({
      topicAffinities: { "spam": -0.5, "clickbait": -0.3, "ok": -0.1 },
    });
    const ctx = getContext(profile);
    expect(ctx.lowAffinityTopics).toContain("spam");
    expect(ctx.lowAffinityTopics).toContain("clickbait");
    expect(ctx.lowAffinityTopics).not.toContain("ok");
  });

  it("limits low affinity topics to 5", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 8; i++) {
      affinities[`bad-${i}`] = -0.2 - (i * 0.05);
    }
    const profile = makeProfile({ topicAffinities: affinities });
    const ctx = getContext(profile);
    expect(ctx.lowAffinityTopics).toHaveLength(5);
  });

  it("extracts trusted authors (trust >= 0.3)", () => {
    const profile = makeProfile({
      authorTrust: {
        "trusted": { validates: 5, flags: 0, trust: 0.8 },
        "neutral": { validates: 1, flags: 1, trust: 0.0 },
        "untrusted": { validates: 0, flags: 5, trust: -0.5 },
      },
    });
    const ctx = getContext(profile);
    expect(ctx.trustedAuthors).toEqual(["trusted"]);
  });

  it("deduplicates and limits recent topics to 10", () => {
    const now = Date.now();
    const profile = makeProfile({
      recentTopics: [
        { topic: "ai", timestamp: now - 1, weight: 1 },
        { topic: "ai", timestamp: now, weight: 1 }, // duplicate
        { topic: "ml", timestamp: now - 2, weight: 1 },
        ...Array.from({ length: 12 }, (_, i) => ({
          topic: `t${i}`,
          timestamp: now - 100 - i, // older than ai/ml
          weight: 1,
        })),
      ],
    });
    const ctx = getContext(profile);
    expect(ctx.recentTopics.length).toBeLessThanOrEqual(10);
    // "ai" appears only once despite two entries
    expect(ctx.recentTopics.filter(t => t === "ai")).toHaveLength(1);
    // Most recent topics come first
    expect(ctx.recentTopics[0]).toBe("ai");
    expect(ctx.recentTopics[1]).toBe("ml");
  });

  it("returns empty arrays for empty profile", () => {
    const profile = makeProfile();
    const ctx = getContext(profile);
    expect(ctx.highAffinityTopics).toEqual([]);
    expect(ctx.lowAffinityTopics).toEqual([]);
    expect(ctx.trustedAuthors).toEqual([]);
    expect(ctx.recentTopics).toEqual([]);
  });
});

describe("hasEnoughData", () => {
  it("returns false for 0 interactions", () => {
    expect(hasEnoughData(makeProfile())).toBe(false);
  });

  it("returns false for 1-2 interactions", () => {
    expect(hasEnoughData(makeProfile({ totalValidated: 1, totalFlagged: 1 }))).toBe(false);
    expect(hasEnoughData(makeProfile({ totalValidated: 2 }))).toBe(false);
  });

  it("returns true for exactly 3 interactions", () => {
    expect(hasEnoughData(makeProfile({ totalValidated: 2, totalFlagged: 1 }))).toBe(true);
    expect(hasEnoughData(makeProfile({ totalValidated: 3 }))).toBe(true);
    expect(hasEnoughData(makeProfile({ totalFlagged: 3 }))).toBe(true);
  });

  it("returns true for many interactions", () => {
    expect(hasEnoughData(makeProfile({ totalValidated: 100, totalFlagged: 50 }))).toBe(true);
  });
});
