/**
 * Edge case tests for collaborative similarity — math boundaries,
 * case sensitivity, zero vectors, large inputs.
 * Exercises real code paths (no mocking).
 */
import {
  computeTopicSimilarity,
  findSimilarUsers,
  generateCommunityPicks,
} from "@/lib/collaborative/similarity";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { GlobalBriefingContributor } from "@/lib/d2a/briefingProvider";

function makeContributor(
  principal: string,
  topItems: Array<{ title: string; topics: string[]; briefingScore: number; verdict: "quality" | "slop" }>,
): GlobalBriefingContributor {
  return {
    principal,
    generatedAt: new Date().toISOString(),
    summary: { totalEvaluated: 10, totalBurned: 2, qualityRate: 0.8 },
    topItems,
  };
}

describe("computeTopicSimilarity — edge cases", () => {
  it("returns 0 for both empty inputs", () => {
    const { similarity, sharedTopics } = computeTopicSimilarity({}, []);
    expect(similarity).toBe(0);
    expect(sharedTopics).toHaveLength(0);
  });

  it("returns 0 when user has topics but contributor has none", () => {
    const { similarity } = computeTopicSimilarity({ ai: 0.9, ml: 0.5 }, []);
    expect(similarity).toBe(0);
  });

  it("returns 0 when user has empty affinities object", () => {
    const { similarity } = computeTopicSimilarity({}, ["ai", "ml"]);
    expect(similarity).toBe(0);
  });

  it("handles case sensitivity — topics are lowercased in contributor vector", () => {
    // computeTopicSimilarity lowercases contributor topics
    // but user affinities keys are used as-is
    const { similarity: sim1 } = computeTopicSimilarity({ ai: 0.8 }, ["AI"]);
    const { similarity: sim2 } = computeTopicSimilarity({ ai: 0.8 }, ["ai"]);
    // Both should match since contributor topics are lowercased
    expect(sim1).toBe(sim2);
  });

  it("user key 'AI' does NOT match contributor topic 'ai' (user keys not lowered)", () => {
    const { similarity } = computeTopicSimilarity({ AI: 0.8 }, ["ai"]);
    // Contributor vector has 'ai', user key is 'AI' — mismatch in Map lookup
    expect(similarity).toBe(0);
  });

  it("handles all-zero user affinities", () => {
    const { similarity } = computeTopicSimilarity({ ai: 0, ml: 0 }, ["ai", "ml"]);
    // userPos = Math.max(0, 0) = 0, so no dot product contribution
    expect(similarity).toBe(0);
  });

  it("handles all-negative user affinities", () => {
    const { similarity } = computeTopicSimilarity({ ai: -1, ml: -2 }, ["ai", "ml"]);
    expect(similarity).toBe(0);
  });

  it("handles duplicate contributor topics (increases weight)", () => {
    const { similarity: sim1 } = computeTopicSimilarity({ ai: 1.0 }, ["ai"]);
    const { similarity: sim2 } = computeTopicSimilarity({ ai: 1.0 }, ["ai", "ai", "ai"]);
    // Same similarity = 1.0 because cosine similarity normalizes by magnitude
    expect(sim1).toBeCloseTo(1.0, 4);
    expect(sim2).toBeCloseTo(1.0, 4);
  });

  it("correctly handles single shared topic among many", () => {
    const { similarity, sharedTopics } = computeTopicSimilarity(
      { ai: 0.5 },
      ["ai", "blockchain", "defi", "web3", "crypto"],
    );
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
    expect(sharedTopics).toEqual(["ai"]);
  });

  it("similarity is bounded between 0 and 1", () => {
    // Test with extreme values
    const { similarity } = computeTopicSimilarity(
      { ai: 100, ml: 100 },
      ["ai", "ml"],
    );
    expect(similarity).toBeGreaterThanOrEqual(0);
    expect(similarity).toBeLessThanOrEqual(1);
  });

  it("handles large number of topics efficiently", () => {
    const affinities: Record<string, number> = {};
    const topics: string[] = [];
    for (let i = 0; i < 1000; i++) {
      affinities[`topic${i}`] = Math.random();
      topics.push(`topic${i}`);
    }
    const { similarity } = computeTopicSimilarity(affinities, topics);
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThanOrEqual(1);
  });

  it("mixed positive and negative affinities — only positives count", () => {
    const { similarity, sharedTopics } = computeTopicSimilarity(
      { liked: 0.9, disliked: -0.9, neutral: 0 },
      ["liked", "disliked", "neutral"],
    );
    expect(sharedTopics).toContain("liked");
    expect(sharedTopics).not.toContain("disliked");
    expect(sharedTopics).not.toContain("neutral");
  });

  it("cosine similarity equals 1 for proportional vectors", () => {
    // user = {a:2, b:4}, contrib = [a, a, b, b, b, b] → {a:2, b:4}
    // Proportional → cosine = 1
    const { similarity } = computeTopicSimilarity(
      { a: 2, b: 4 },
      ["a", "a", "b", "b", "b", "b"],
    );
    expect(similarity).toBeCloseTo(1.0, 4);
  });

  it("orthogonal vectors yield 0", () => {
    const { similarity } = computeTopicSimilarity(
      { x: 1, y: 0 },
      ["z"], // completely different topic
    );
    expect(similarity).toBe(0);
  });
});

describe("findSimilarUsers — edge cases", () => {
  it("handles profile with no topic affinities", () => {
    const profile = { ...createEmptyProfile("me"), topicAffinities: {} };
    const contributors = [
      makeContributor("other", [
        { title: "Article", topics: ["ai"], briefingScore: 8, verdict: "quality" },
      ]),
    ];
    const result = findSimilarUsers(profile, contributors);
    expect(result).toHaveLength(0);
  });

  it("handles contributor with no items", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9 },
    };
    const contributor = makeContributor("other", []);
    const result = findSimilarUsers(profile, [contributor]);
    expect(result).toHaveLength(0);
  });

  it("handles many contributors — returns sorted by similarity", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9, ml: 0.7 },
    };
    const contributors = Array.from({ length: 20 }, (_, i) =>
      makeContributor(`user-${i}`, [
        { title: `Article ${i}`, topics: i % 3 === 0 ? ["ai", "ml"] : ["cooking"], briefingScore: 5, verdict: "quality" },
      ]),
    );
    const result = findSimilarUsers(profile, contributors);
    // All with ai/ml topics should be returned (every 3rd contributor)
    expect(result.length).toBeGreaterThan(0);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].similarity).toBeGreaterThanOrEqual(result[i].similarity);
    }
  });

  it("minSimilarity = 0 includes all non-zero similarity users", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.01 }, // very low affinity
    };
    const contributor = makeContributor("other", [
      { title: "AI Article", topics: ["ai"], briefingScore: 5, verdict: "quality" },
    ]);
    const result = findSimilarUsers(profile, [contributor], 0);
    // Even very low similarity should be included (> 0)
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("minSimilarity = 1 excludes all except perfect matches", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.8, cooking: 0.5 },
    };
    const contributor = makeContributor("other", [
      { title: "AI Cooking", topics: ["ai"], briefingScore: 8, verdict: "quality" },
    ]);
    const result = findSimilarUsers(profile, [contributor], 1.0);
    // Partial overlap → similarity < 1 → filtered out
    expect(result).toHaveLength(0);
  });
});

describe("generateCommunityPicks — edge cases", () => {
  it("excludes slop items from picks", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9 },
    };
    const contributors = [
      makeContributor("peer", [
        { title: "Slop 1", topics: ["ai"], briefingScore: 8, verdict: "slop" },
        { title: "Slop 2", topics: ["ai"], briefingScore: 9, verdict: "slop" },
      ]),
    ];
    const picks = generateCommunityPicks(profile, contributors);
    expect(picks).toHaveLength(0);
  });

  it("deduplicates case-insensitively by title", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9 },
    };
    const contributors = [
      makeContributor("peer1", [
        { title: "Great Article", topics: ["ai"], briefingScore: 9, verdict: "quality" },
      ]),
      makeContributor("peer2", [
        { title: "GREAT ARTICLE", topics: ["ai"], briefingScore: 8, verdict: "quality" },
      ]),
    ];
    const picks = generateCommunityPicks(profile, contributors);
    expect(picks).toHaveLength(1);
  });

  it("cfScore = briefingScore * similarity", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 1.0 },
    };
    const contributors = [
      makeContributor("peer", [
        { title: "AI Article", topics: ["ai"], briefingScore: 8, verdict: "quality" },
      ]),
    ];
    const picks = generateCommunityPicks(profile, contributors);
    expect(picks).toHaveLength(1);
    // similarity should be 1.0 for identical single topic
    expect(picks[0].cfScore).toBeCloseTo(8 * picks[0].similarity, 4);
  });

  it("maxPicks = 0 returns empty", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9 },
    };
    const contributors = [
      makeContributor("peer", [
        { title: "Article", topics: ["ai"], briefingScore: 8, verdict: "quality" },
      ]),
    ];
    const picks = generateCommunityPicks(profile, contributors, 0);
    expect(picks).toHaveLength(0);
  });

  it("maxPicks = 1 returns only top pick", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9 },
    };
    const contributors = [
      makeContributor("peer", [
        { title: "Low", topics: ["ai"], briefingScore: 3, verdict: "quality" },
        { title: "High", topics: ["ai"], briefingScore: 9, verdict: "quality" },
      ]),
    ];
    const picks = generateCommunityPicks(profile, contributors, 1);
    expect(picks).toHaveLength(1);
    expect(picks[0].title).toBe("High");
  });

  it("handles contributor with mixed quality and slop", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9, ml: 0.7 },
    };
    const contributors = [
      makeContributor("peer", [
        { title: "Quality 1", topics: ["ai"], briefingScore: 9, verdict: "quality" },
        { title: "Slop 1", topics: ["ai"], briefingScore: 8, verdict: "slop" },
        { title: "Quality 2", topics: ["ml"], briefingScore: 7, verdict: "quality" },
        { title: "Slop 2", topics: ["ml"], briefingScore: 6, verdict: "slop" },
      ]),
    ];
    const picks = generateCommunityPicks(profile, contributors);
    expect(picks.every(p => p.verdict === "quality")).toBe(true);
    expect(picks).toHaveLength(2);
  });
});
