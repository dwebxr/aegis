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

describe("computeTopicSimilarity", () => {
  it("returns 0 when contributor has no topics", () => {
    const { similarity } = computeTopicSimilarity({ ai: 0.8 }, []);
    expect(similarity).toBe(0);
  });

  it("returns 0 when user has no positive affinities", () => {
    const { similarity } = computeTopicSimilarity({ ai: -0.5 }, ["ai", "ml"]);
    expect(similarity).toBe(0);
  });

  it("returns 1 for identical topic sets", () => {
    const { similarity } = computeTopicSimilarity({ ai: 1.0 }, ["ai"]);
    expect(similarity).toBeCloseTo(1.0, 4);
  });

  it("computes meaningful similarity for overlapping topics", () => {
    const { similarity, sharedTopics } = computeTopicSimilarity(
      { ai: 0.8, blockchain: 0.6, cooking: 0.3 },
      ["ai", "blockchain", "finance"],
    );
    expect(similarity).toBeGreaterThan(0.3);
    expect(similarity).toBeLessThan(1.0);
    expect(sharedTopics).toContain("ai");
    expect(sharedTopics).toContain("blockchain");
  });

  it("returns 0 for completely disjoint topics", () => {
    const { similarity, sharedTopics } = computeTopicSimilarity(
      { cooking: 0.9, gardening: 0.7 },
      ["ai", "blockchain"],
    );
    expect(similarity).toBe(0);
    expect(sharedTopics).toHaveLength(0);
  });

  it("ignores negative affinities", () => {
    const { similarity } = computeTopicSimilarity(
      { ai: 0.8, spam: -0.9 },
      ["ai", "spam"],
    );
    // Spam has negative affinity so shouldn't contribute to similarity
    const { similarity: simWithoutSpam } = computeTopicSimilarity(
      { ai: 0.8 },
      ["ai", "spam"],
    );
    expect(similarity).toBeCloseTo(simWithoutSpam, 4);
  });
});

describe("findSimilarUsers", () => {
  it("returns empty array when no contributors", () => {
    const profile = createEmptyProfile("user1");
    const result = findSimilarUsers(profile, []);
    expect(result).toEqual([]);
  });

  it("excludes self from results", () => {
    const profile = { ...createEmptyProfile("self"), topicAffinities: { ai: 0.9 } };
    const contributor = makeContributor("self", [
      { title: "AI Article", topics: ["ai"], briefingScore: 8, verdict: "quality" },
    ]);
    const result = findSimilarUsers(profile, [contributor]);
    expect(result).toHaveLength(0);
  });

  it("finds similar users based on topic overlap", () => {
    const profile = {
      ...createEmptyProfile("user1"),
      topicAffinities: { ai: 0.8, blockchain: 0.6, security: 0.4 },
    };

    const contributors = [
      makeContributor("user2", [
        { title: "AI Progress", topics: ["ai", "ml"], briefingScore: 8, verdict: "quality" },
        { title: "Crypto News", topics: ["blockchain"], briefingScore: 7, verdict: "quality" },
      ]),
      makeContributor("user3", [
        { title: "Garden Tips", topics: ["gardening"], briefingScore: 9, verdict: "quality" },
      ]),
    ];

    const result = findSimilarUsers(profile, contributors);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].principal).toBe("user2");
    expect(result[0].similarity).toBeGreaterThan(0);
  });

  it("sorts by similarity descending", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9, security: 0.7, web: 0.3 },
    };

    const contributors = [
      makeContributor("low-sim", [
        { title: "Web Article", topics: ["web"], briefingScore: 6, verdict: "quality" },
      ]),
      makeContributor("high-sim", [
        { title: "AI Security", topics: ["ai", "security"], briefingScore: 9, verdict: "quality" },
      ]),
    ];

    const result = findSimilarUsers(profile, contributors);
    if (result.length >= 2) {
      expect(result[0].similarity).toBeGreaterThanOrEqual(result[1].similarity);
    }
  });

  it("respects minSimilarity threshold", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9 },
    };

    const contributor = makeContributor("other", [
      { title: "Gardening", topics: ["gardening"], briefingScore: 8, verdict: "quality" },
    ]);

    const result = findSimilarUsers(profile, [contributor], 0.5);
    expect(result).toHaveLength(0);
  });
});

describe("generateCommunityPicks", () => {
  it("returns empty array when no similar users", () => {
    const profile = { ...createEmptyProfile("me"), topicAffinities: { cooking: 0.9 } };
    const contributor = makeContributor("other", [
      { title: "AI Article", topics: ["ai"], briefingScore: 8, verdict: "quality" },
    ]);
    const picks = generateCommunityPicks(profile, [contributor]);
    expect(picks).toEqual([]);
  });

  it("generates picks from similar users", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.8, ml: 0.6 },
    };

    const contributors = [
      makeContributor("peer1", [
        { title: "Deep Learning", topics: ["ai", "ml"], briefingScore: 9, verdict: "quality" },
        { title: "Spam Item", topics: ["ai"], briefingScore: 5, verdict: "slop" },
      ]),
    ];

    const picks = generateCommunityPicks(profile, contributors);
    expect(picks.length).toBeGreaterThanOrEqual(1);
    expect(picks[0].title).toBe("Deep Learning");
    expect(picks[0].cfScore).toBeGreaterThan(0);
    // Slop items should be filtered out
    expect(picks.every(p => p.verdict === "quality")).toBe(true);
  });

  it("deduplicates items by title", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.8 },
    };

    const contributors = [
      makeContributor("peer1", [
        { title: "Same Article", topics: ["ai"], briefingScore: 9, verdict: "quality" },
      ]),
      makeContributor("peer2", [
        { title: "Same Article", topics: ["ai"], briefingScore: 8, verdict: "quality" },
      ]),
    ];

    const picks = generateCommunityPicks(profile, contributors);
    const titles = picks.map(p => p.title);
    const uniqueTitles = new Set(titles);
    expect(titles.length).toBe(uniqueTitles.size);
  });

  it("limits picks to maxPicks", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.9 },
    };

    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Article ${i}`,
      topics: ["ai"],
      briefingScore: 8,
      verdict: "quality" as const,
    }));

    const contributors = [makeContributor("peer", items)];
    const picks = generateCommunityPicks(profile, contributors, 3);
    expect(picks.length).toBeLessThanOrEqual(3);
  });

  it("sorts picks by cfScore descending", () => {
    const profile = {
      ...createEmptyProfile("me"),
      topicAffinities: { ai: 0.8, web: 0.3 },
    };

    const contributors = [
      makeContributor("peer", [
        { title: "Low Score", topics: ["ai"], briefingScore: 3, verdict: "quality" },
        { title: "High Score", topics: ["ai"], briefingScore: 9, verdict: "quality" },
        { title: "Mid Score", topics: ["ai"], briefingScore: 6, verdict: "quality" },
      ]),
    ];

    const picks = generateCommunityPicks(profile, contributors);
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i - 1].cfScore).toBeGreaterThanOrEqual(picks[i].cfScore);
    }
  });
});
