import { learn, getContext, hasEnoughData } from "@/lib/preferences/engine";
import { createEmptyProfile, TOPIC_AFFINITY_CAP, TOPIC_AFFINITY_FLOOR, AUTHOR_TRUST_CAP, AUTHOR_TRUST_FLOOR, RECENT_TOPICS_MAX } from "@/lib/preferences/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

function makeProfile(overrides: Partial<UserPreferenceProfile> = {}): UserPreferenceProfile {
  return { ...createEmptyProfile("test-principal"), ...overrides };
}

describe("learn — edge cases", () => {
  describe("topic affinity saturation", () => {
    it("clamps topic affinity at TOPIC_AFFINITY_CAP (1.0) after many validates", () => {
      let profile = makeProfile();
      // Validate the same topic many times to push to cap
      for (let i = 0; i < 50; i++) {
        profile = learn(profile, {
          action: "validate",
          topics: ["AI"],
          author: "author",
          composite: 7,
          verdict: "quality",
        });
      }
      expect(profile.topicAffinities["AI"]).toBe(TOPIC_AFFINITY_CAP);
    });

    it("clamps topic affinity at TOPIC_AFFINITY_FLOOR (-1.0) after many flags", () => {
      let profile = makeProfile();
      for (let i = 0; i < 100; i++) {
        profile = learn(profile, {
          action: "flag",
          topics: ["spam"],
          author: "spammer",
          composite: 2,
          verdict: "slop",
        });
      }
      expect(profile.topicAffinities["spam"]).toBe(TOPIC_AFFINITY_FLOOR);
    });
  });

  describe("author trust saturation", () => {
    it("clamps author trust at AUTHOR_TRUST_CAP after many validates", () => {
      let profile = makeProfile();
      for (let i = 0; i < 50; i++) {
        profile = learn(profile, {
          action: "validate",
          topics: ["test"],
          author: "trusted-author",
          composite: 8,
          verdict: "quality",
        });
      }
      expect(profile.authorTrust["trusted-author"].trust).toBe(AUTHOR_TRUST_CAP);
      expect(profile.authorTrust["trusted-author"].validates).toBe(50);
    });

    it("clamps author trust at AUTHOR_TRUST_FLOOR after many flags", () => {
      let profile = makeProfile();
      for (let i = 0; i < 50; i++) {
        profile = learn(profile, {
          action: "flag",
          topics: ["test"],
          author: "untrusted-author",
          composite: 3,
          verdict: "slop",
        });
      }
      expect(profile.authorTrust["untrusted-author"].trust).toBe(AUTHOR_TRUST_FLOOR);
      expect(profile.authorTrust["untrusted-author"].flags).toBe(50);
    });
  });

  describe("conflicting feedback", () => {
    it("handles validate then flag on same topic — affinity decreases", () => {
      let profile = makeProfile();

      // Validate 5 times
      for (let i = 0; i < 5; i++) {
        profile = learn(profile, {
          action: "validate",
          topics: ["AI"],
          author: "author",
          composite: 7,
          verdict: "quality",
        });
      }
      const afterValidate = profile.topicAffinities["AI"];
      expect(afterValidate).toBeGreaterThan(0);

      // Then flag 3 times
      for (let i = 0; i < 3; i++) {
        profile = learn(profile, {
          action: "flag",
          topics: ["AI"],
          author: "author",
          composite: 3,
          verdict: "slop",
        });
      }
      // Affinity should decrease but still be positive (5*0.1 - 3*0.05 = 0.35)
      expect(profile.topicAffinities["AI"]).toBeLessThan(afterValidate);
      expect(profile.topicAffinities["AI"]).toBeGreaterThan(0);
    });

    it("handles flag then validate on same author — trust recovers", () => {
      let profile = makeProfile();

      // Flag 2 times
      for (let i = 0; i < 2; i++) {
        profile = learn(profile, {
          action: "flag",
          topics: ["test"],
          author: "mixed-author",
          composite: 2,
          verdict: "slop",
        });
      }
      const afterFlag = profile.authorTrust["mixed-author"].trust;
      expect(afterFlag).toBeLessThan(0);

      // Validate 5 times
      for (let i = 0; i < 5; i++) {
        profile = learn(profile, {
          action: "validate",
          topics: ["test"],
          author: "mixed-author",
          composite: 7,
          verdict: "quality",
        });
      }
      expect(profile.authorTrust["mixed-author"].trust).toBeGreaterThan(afterFlag);
      expect(profile.authorTrust["mixed-author"].validates).toBe(5);
      expect(profile.authorTrust["mixed-author"].flags).toBe(2);
    });
  });

  describe("quality threshold calibration", () => {
    it("lowers threshold when borderline content (3.5-4.5) is validated", () => {
      let profile = makeProfile();
      const originalThreshold = profile.calibration.qualityThreshold;

      profile = learn(profile, {
        action: "validate",
        topics: ["test"],
        author: "author",
        composite: 4.0, // borderline
        verdict: "quality",
      });

      expect(profile.calibration.qualityThreshold).toBeLessThan(originalThreshold);
    });

    it("does NOT lower threshold when high-confidence content is validated", () => {
      let profile = makeProfile();
      const originalThreshold = profile.calibration.qualityThreshold;

      profile = learn(profile, {
        action: "validate",
        topics: ["test"],
        author: "author",
        composite: 8.0, // high confidence, not borderline
        verdict: "quality",
      });

      expect(profile.calibration.qualityThreshold).toBe(originalThreshold);
    });

    it("raises threshold when quality-verdict content is flagged", () => {
      let profile = makeProfile();
      const originalThreshold = profile.calibration.qualityThreshold;

      profile = learn(profile, {
        action: "flag",
        topics: ["test"],
        author: "author",
        composite: 6.0,
        verdict: "quality", // was marked quality but user flagged it
      });

      expect(profile.calibration.qualityThreshold).toBeGreaterThan(originalThreshold);
    });

    it("does NOT raise threshold when slop is flagged (expected behavior)", () => {
      let profile = makeProfile();
      const originalThreshold = profile.calibration.qualityThreshold;

      profile = learn(profile, {
        action: "flag",
        topics: ["test"],
        author: "author",
        composite: 2.0,
        verdict: "slop", // was already slop, flagging confirms
      });

      expect(profile.calibration.qualityThreshold).toBe(originalThreshold);
    });

    it("threshold does not go below 1", () => {
      let profile = makeProfile({ calibration: { ...createEmptyProfile("x").calibration, qualityThreshold: 1.0 } });

      profile = learn(profile, {
        action: "validate",
        topics: ["test"],
        author: "author",
        composite: 4.0,
        verdict: "quality",
      });

      expect(profile.calibration.qualityThreshold).toBeGreaterThanOrEqual(1);
    });

    it("threshold does not go above 9", () => {
      let profile = makeProfile({ calibration: { ...createEmptyProfile("x").calibration, qualityThreshold: 9.0 } });

      profile = learn(profile, {
        action: "flag",
        topics: ["test"],
        author: "author",
        composite: 7,
        verdict: "quality",
      });

      expect(profile.calibration.qualityThreshold).toBeLessThanOrEqual(9);
    });
  });

  describe("recentTopics overflow", () => {
    it("prunes to RECENT_TOPICS_MAX when exceeding limit", () => {
      let profile = makeProfile();

      // Add more than RECENT_TOPICS_MAX topics
      for (let i = 0; i < RECENT_TOPICS_MAX + 20; i++) {
        profile = learn(profile, {
          action: "validate",
          topics: [`topic-${i}`],
          author: "author",
          composite: 7,
          verdict: "quality",
        });
      }

      expect(profile.recentTopics.length).toBeLessThanOrEqual(RECENT_TOPICS_MAX);
    });

    it("keeps most recent topics after pruning", () => {
      let profile = makeProfile();

      for (let i = 0; i < RECENT_TOPICS_MAX + 5; i++) {
        profile = learn(profile, {
          action: "validate",
          topics: [`topic-${i}`],
          author: "author",
          composite: 7,
          verdict: "quality",
        });
      }

      // Most recent should be present
      const topicNames = profile.recentTopics.map(rt => rt.topic);
      expect(topicNames).toContain(`topic-${RECENT_TOPICS_MAX + 4}`);
    });
  });

  describe("empty author handling", () => {
    it("does not create author entry for empty string author", () => {
      let profile = makeProfile();

      profile = learn(profile, {
        action: "validate",
        topics: ["test"],
        author: "",
        composite: 7,
        verdict: "quality",
      });

      expect(Object.keys(profile.authorTrust).length).toBe(0);
    });
  });

  describe("multi-topic events", () => {
    it("updates all topics in a single event", () => {
      let profile = makeProfile();

      profile = learn(profile, {
        action: "validate",
        topics: ["AI", "ML", "transformers"],
        author: "author",
        composite: 7,
        verdict: "quality",
      });

      expect(profile.topicAffinities["AI"]).toBeGreaterThan(0);
      expect(profile.topicAffinities["ML"]).toBeGreaterThan(0);
      expect(profile.topicAffinities["transformers"]).toBeGreaterThan(0);
    });
  });
});

describe("getContext — edge cases", () => {
  it("returns empty arrays for empty profile", () => {
    const profile = makeProfile();
    const ctx = getContext(profile);
    expect(ctx.highAffinityTopics).toEqual([]);
    expect(ctx.lowAffinityTopics).toEqual([]);
    expect(ctx.trustedAuthors).toEqual([]);
    expect(ctx.recentTopics).toEqual([]);
  });

  it("limits highAffinityTopics to 10", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      affinities[`topic-${i}`] = 0.5 + i * 0.01;
    }
    const profile = makeProfile({ topicAffinities: affinities });
    const ctx = getContext(profile);
    expect(ctx.highAffinityTopics.length).toBeLessThanOrEqual(10);
  });

  it("limits lowAffinityTopics to 5", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      affinities[`topic-${i}`] = -0.3 - i * 0.01;
    }
    const profile = makeProfile({ topicAffinities: affinities });
    const ctx = getContext(profile);
    expect(ctx.lowAffinityTopics.length).toBeLessThanOrEqual(5);
  });

  it("limits trustedAuthors to 10", () => {
    const trust: Record<string, { validates: number; flags: number; trust: number }> = {};
    for (let i = 0; i < 20; i++) {
      trust[`author-${i}`] = { validates: 10, flags: 0, trust: 0.5 + i * 0.01 };
    }
    const profile = makeProfile({ authorTrust: trust });
    const ctx = getContext(profile);
    expect(ctx.trustedAuthors.length).toBeLessThanOrEqual(10);
  });

  it("deduplicates recentTopics", () => {
    const now = Date.now();
    const profile = makeProfile({
      recentTopics: [
        { topic: "AI", timestamp: now, weight: 1 },
        { topic: "AI", timestamp: now - 1000, weight: 1 },
        { topic: "ML", timestamp: now - 2000, weight: 1 },
      ],
    });
    const ctx = getContext(profile);
    expect(ctx.recentTopics.filter(t => t === "AI").length).toBe(1);
  });

  it("sorts highAffinityTopics by affinity (highest first)", () => {
    const profile = makeProfile({
      topicAffinities: { "low": 0.4, "high": 0.9, "mid": 0.6 },
    });
    const ctx = getContext(profile);
    expect(ctx.highAffinityTopics[0]).toBe("high");
  });
});

describe("hasEnoughData", () => {
  it("returns false with 0 interactions", () => {
    expect(hasEnoughData(makeProfile())).toBe(false);
  });

  it("returns false with 2 interactions", () => {
    expect(hasEnoughData(makeProfile({ totalValidated: 1, totalFlagged: 1 }))).toBe(false);
  });

  it("returns true with exactly 3 interactions", () => {
    expect(hasEnoughData(makeProfile({ totalValidated: 2, totalFlagged: 1 }))).toBe(true);
  });

  it("returns true with many interactions", () => {
    expect(hasEnoughData(makeProfile({ totalValidated: 100, totalFlagged: 50 }))).toBe(true);
  });

  it("counts validates and flags together", () => {
    expect(hasEnoughData(makeProfile({ totalValidated: 3, totalFlagged: 0 }))).toBe(true);
    expect(hasEnoughData(makeProfile({ totalValidated: 0, totalFlagged: 3 }))).toBe(true);
  });
});
