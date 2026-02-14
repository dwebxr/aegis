import { heuristicScores } from "@/lib/ingestion/quickFilter";
import { learn, getContext, hasEnoughData } from "@/lib/preferences/engine";
import { createEmptyProfile } from "@/lib/preferences/types";
import { generateBriefing } from "@/lib/briefing/ranker";
import type { ContentItem } from "@/lib/types/content";
import { v4 as uuidv4 } from "uuid";

function makeContentItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const scores = heuristicScores(overrides.text || "Default test content");
  return {
    id: uuidv4(),
    owner: "test-principal",
    author: "test-author",
    avatar: "🔍",
    text: (overrides.text || "Default test content").slice(0, 300),
    source: "manual",
    scores: {
      originality: scores.originality,
      insight: scores.insight,
      credibility: scores.credibility,
      composite: scores.composite,
    },
    verdict: scores.verdict,
    reason: scores.reason,
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: overrides.topics || ["test"],
    ...overrides,
  };
}

describe("Content → Scoring → Preference Learning flow", () => {
  it("heuristic scoring → preference learning → context extraction", () => {
    // Step 1: Score content
    const highQuality = heuristicScores(
      "According to the latest analysis, the correlation between data points reveals a significant framework. " +
      "The methodology uses benchmarking and implementation of the algorithm across multiple datasets. " +
      "Evidence from cited sources confirms the hypothesis. The results demonstrate a 45% improvement.\n\n" +
      "This research provides new insights into transformer architectures. https://arxiv.org/paper/123"
    );
    expect(highQuality.composite).toBeGreaterThan(5);
    expect(highQuality.verdict).toBe("quality");

    const lowQuality = heuristicScores("OMG!!! THIS IS AMAZING!!! 🔥🔥🔥 MUST SEE!!!");
    expect(lowQuality.composite).toBeLessThan(5);
    expect(lowQuality.verdict).toBe("slop");

    // Step 2: Learn from user actions
    let profile = createEmptyProfile("test-principal");

    // Validate the high-quality content
    profile = learn(profile, {
      action: "validate",
      topics: ["transformers", "ml"],
      author: "ResearchBot",
      composite: highQuality.composite,
      verdict: highQuality.verdict,
    });

    expect(profile.totalValidated).toBe(1);
    expect(profile.topicAffinities["transformers"]).toBeGreaterThan(0);
    expect(profile.topicAffinities["ml"]).toBeGreaterThan(0);

    // Flag the low-quality content
    profile = learn(profile, {
      action: "flag",
      topics: ["engagement-bait"],
      author: "SpamBot",
      composite: lowQuality.composite,
      verdict: lowQuality.verdict,
    });

    expect(profile.totalFlagged).toBe(1);
    expect(profile.topicAffinities["engagement-bait"]).toBeLessThan(0);
    expect(profile.authorTrust["SpamBot"].trust).toBeLessThan(0);
    expect(profile.authorTrust["ResearchBot"].trust).toBeGreaterThan(0);

    // Step 3: Extract context for API
    const ctx = getContext(profile);
    expect(ctx.recentTopics).toContain("transformers");
    expect(ctx.recentTopics).toContain("ml");
  });

  it("hasEnoughData returns false until 3 actions, then true", () => {
    let profile = createEmptyProfile("test");
    expect(hasEnoughData(profile)).toBe(false);

    profile = learn(profile, { action: "validate", topics: ["a"], author: "x", composite: 7, verdict: "quality" });
    expect(hasEnoughData(profile)).toBe(false);

    profile = learn(profile, { action: "flag", topics: ["b"], author: "y", composite: 2, verdict: "slop" });
    expect(hasEnoughData(profile)).toBe(false);

    profile = learn(profile, { action: "validate", topics: ["c"], author: "z", composite: 8, verdict: "quality" });
    expect(hasEnoughData(profile)).toBe(true);
  });
});

describe("Content → Briefing generation flow", () => {
  it("generates briefing from scored content with preference-aware ranking", () => {
    let profile = createEmptyProfile("test-principal");

    // Build affinity for "ai" topic
    for (let i = 0; i < 5; i++) {
      profile = learn(profile, {
        action: "validate", topics: ["ai"], author: "ai-author", composite: 8, verdict: "quality",
      });
    }

    // Create diverse content
    const items: ContentItem[] = [
      makeContentItem({
        text: "AI research breakthrough",
        topics: ["ai"],
        scores: { originality: 9, insight: 9, credibility: 8, composite: 8.8 },
        verdict: "quality",
      }),
      makeContentItem({
        text: "Cooking tips for beginners",
        topics: ["cooking"],
        scores: { originality: 6, insight: 5, credibility: 7, composite: 6.0 },
        verdict: "quality",
      }),
      makeContentItem({
        text: "Low quality spam content",
        topics: ["spam"],
        scores: { originality: 2, insight: 1, credibility: 1, composite: 1.5 },
        verdict: "slop",
      }),
      makeContentItem({
        text: "Another AI article about transformers",
        topics: ["ai", "transformers"],
        scores: { originality: 7, insight: 8, credibility: 7, composite: 7.3 },
        verdict: "quality",
      }),
    ];

    const briefing = generateBriefing(items, profile);

    // Should have priority items (quality content above threshold)
    expect(briefing.priority.length).toBeGreaterThanOrEqual(1);
    expect(briefing.totalItems).toBe(4);

    // AI content should rank higher due to topic affinity
    expect(briefing.priority.length).toBeGreaterThanOrEqual(2);
    const firstTopic = briefing.priority[0].item.topics?.[0];
    expect(firstTopic).toBe("ai");

    // Slop should be filtered out
    const slopInPriority = briefing.priority.find(p => p.item.verdict === "slop");
    expect(slopInPriority).toBeUndefined();
  });

  it("generates serendipity pick from outside user's bubble", () => {
    let profile = createEmptyProfile("test-principal");

    // Build strong affinity for "ai"
    for (let i = 0; i < 10; i++) {
      profile = learn(profile, {
        action: "validate", topics: ["ai"], author: "a", composite: 8, verdict: "quality",
      });
    }

    // Create enough items to fill priority + have serendipity candidate
    const items: ContentItem[] = [];
    for (let i = 0; i < 8; i++) {
      items.push(makeContentItem({
        text: `AI article ${i}`,
        topics: ["ai"],
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7.0 },
        verdict: "quality",
      }));
    }

    // Add a non-AI quality item (serendipity candidate)
    items.push(makeContentItem({
      text: "Fascinating history of ancient Rome",
      topics: ["history", "rome"],
      scores: { originality: 8, insight: 8, credibility: 9, composite: 8.3 },
      verdict: "quality",
      vSignal: 9,
      cContext: 2, // Low context relevance = good serendipity
    }));

    const briefing = generateBriefing(items, profile);

    // Should have a serendipity pick
    expect(briefing.serendipity).toBeDefined();
    expect(briefing.serendipity!.isSerendipity).toBe(true);
  });
});

describe("Heuristic scoring — real content patterns", () => {
  it("scores academic-style content highly", () => {
    const result = heuristicScores(
      "According to recent analysis, the correlation between neural network depth and performance " +
      "shows a significant framework for understanding modern AI systems. The methodology involves " +
      "systematic benchmarking of transformer implementations across 15 datasets. " +
      "Evidence from cited peer-reviewed sources confirms the initial hypothesis.\n\n" +
      "The algorithm demonstrates a 23.5% improvement over baseline. https://arxiv.org/paper"
    );
    expect(result.composite).toBeGreaterThanOrEqual(6);
    expect(result.insight).toBeGreaterThanOrEqual(7);
    expect(result.credibility).toBeGreaterThanOrEqual(7);
  });

  it("scores engagement bait poorly", () => {
    const result = heuristicScores("OMG THIS IS INSANE!!! 🔥🔥🔥 YOU WON'T BELIEVE WHAT HAPPENED!!! 😱😱😱");
    expect(result.composite).toBeLessThan(4);
    expect(result.verdict).toBe("slop");
  });

  it("scores very short content poorly", () => {
    const result = heuristicScores("wow ok");
    expect(result.composite).toBeLessThan(5);
  });

  it("rewards structured multi-paragraph content", () => {
    const result = heuristicScores(
      "First paragraph introduces the topic.\n\n" +
      "Second paragraph provides details.\n\n" +
      "Third paragraph concludes with analysis."
    );
    expect(result.originality).toBeGreaterThanOrEqual(5);
    expect(result.insight).toBeGreaterThanOrEqual(5);
  });

  it("rewards content with data/numbers", () => {
    const result = heuristicScores("Revenue grew by 45% year over year, reaching $2.3 billion in Q4.");
    expect(result.insight).toBeGreaterThanOrEqual(6);
    expect(result.credibility).toBeGreaterThanOrEqual(5);
  });

  it("rewards content with attribution", () => {
    const result = heuristicScores("According to the World Health Organization, cited from the 2024 report.");
    expect(result.credibility).toBeGreaterThanOrEqual(7);
  });
});
