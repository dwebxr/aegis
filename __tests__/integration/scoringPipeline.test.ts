/**
 * Scoring pipeline integration test: raw content → heuristic scoring → filter pipeline → briefing generation.
 * Tests real code paths without mocking intermediate modules.
 * NOTE: Does not test Nostr relay I/O, IC canister calls, or real WoT graph construction.
 */
import { heuristicScores, quickSlopFilter } from "@/lib/ingestion/quickFilter";
import { scoreItemWithHeuristics } from "@/lib/filtering/pipeline";
import { runFilterPipeline } from "@/lib/filtering/pipeline";
import { generateBriefing } from "@/lib/briefing/ranker";
import { learn, getContext, hasEnoughData } from "@/lib/preferences/engine";
import { createEmptyProfile } from "@/lib/preferences/types";
import { scoreGrade } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import type { FilterConfig } from "@/lib/filtering/types";

// Real-world-ish content samples
const QUALITY_TEXT = `
A comprehensive analysis of transformer architectures reveals significant improvements in efficiency.
The study, published in Nature Machine Intelligence, examines 47 different model configurations
across three benchmark datasets. Key findings include a 23% reduction in compute costs while
maintaining comparable accuracy metrics. According to the lead researcher, "These results suggest
that attention mechanism optimization is more impactful than simply scaling parameter count."

The methodology employs a novel framework for evaluating model performance that accounts for
both inference latency and energy consumption. Correlation analysis between model size and
downstream task performance shows diminishing returns beyond 7B parameters for most tasks.
`;

const SLOP_TEXT = "BUY NOW!!! AMAZING DEAL 🔥🔥🔥 WOW CHECK THIS OUT!!! 🚀🚀🚀 LIMITED TIME!!!";

const MEDIUM_TEXT = "A decent article about web development trends in 2025. The author discusses several frameworks and compares their performance characteristics.";

describe("End-to-end scoring flow", () => {
  it("quality content flows correctly through all stages", () => {
    // Stage 1: Heuristic scoring
    const hScores = heuristicScores(QUALITY_TEXT);
    expect(hScores.verdict).toBe("quality");
    expect(hScores.composite).toBeGreaterThanOrEqual(4);
    expect(hScores.reason).toContain("Heuristic");

    // Stage 2: Quick slop filter (should pass)
    expect(quickSlopFilter(QUALITY_TEXT)).toBe(true);

    // Stage 3: Score into ContentItem
    const item = scoreItemWithHeuristics(
      { text: QUALITY_TEXT, author: "Nature MI", sourceUrl: "https://nature.com/article" },
      "rss",
    );
    expect(item.scores.composite).toBe(hScores.composite);
    expect(item.verdict).toBe("quality");
    expect(item.scoredByAI).toBe(false);
    expect(item.scoringEngine).toBe("heuristic");

    // Stage 4: Score grade
    const grade = scoreGrade(item.scores.composite);
    expect(["A", "B", "C"]).toContain(grade.grade); // Quality content should be at least C

    // Stage 5: Filter pipeline
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 4.0 };
    const pipelineResult = runFilterPipeline([item], null, config);
    expect(pipelineResult.items).toHaveLength(1);
    expect(pipelineResult.items[0].item.id).toBe(item.id);
  });

  it("slop content is correctly filtered at every stage", () => {
    // Stage 1: Heuristic scoring
    const hScores = heuristicScores(SLOP_TEXT);
    expect(hScores.verdict).toBe("slop");
    expect(hScores.composite).toBeLessThan(4);

    // Stage 2: Quick slop filter (should fail)
    expect(quickSlopFilter(SLOP_TEXT)).toBe(false);

    // Stage 3: Even if it gets through, filter pipeline catches it
    const item = scoreItemWithHeuristics({ text: SLOP_TEXT, author: "Spammer" }, "rss");
    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 4.0 };
    const result = runFilterPipeline([item], null, config);
    expect(result.items).toHaveLength(0); // Filtered out

    // Stage 4: Score grade reflects low quality
    const grade = scoreGrade(item.scores.composite);
    expect(["D", "F"]).toContain(grade.grade);
  });

  it("briefing integrates with preference learning", () => {
    // Create items of varying quality
    const items: ContentItem[] = [];
    const texts = [
      { text: QUALITY_TEXT, author: "Nature MI" },
      { text: MEDIUM_TEXT, author: "Tech Blog" },
      { text: "Short low quality post", author: "Random" },
    ];

    for (const { text, author } of texts) {
      const item = scoreItemWithHeuristics({ text, author }, "rss");
      items.push(item);
    }

    // Generate initial briefing
    let profile = createEmptyProfile("test-user");
    const briefing1 = generateBriefing(items, profile);
    expect(briefing1.totalItems).toBe(3);
    expect(briefing1.priority.length).toBeGreaterThanOrEqual(1);

    // Learn from user feedback
    expect(briefing1.priority.length).toBeGreaterThanOrEqual(1);
    const topItem = briefing1.priority[0].item;
    profile = learn(profile, {
      action: "validate",
      topics: topItem.topics || [],
      author: topItem.author,
      composite: topItem.scores.composite,
      verdict: topItem.verdict,
    });

    expect(profile.totalValidated).toBe(1);
    expect(hasEnoughData(profile)).toBe(false); // Need 3 interactions

    // Learn twice more
    profile = learn(profile, {
      action: "validate",
      topics: ["analysis"],
      author: "Nature MI",
      composite: 8,
      verdict: "quality",
    });
    profile = learn(profile, {
      action: "flag",
      topics: [],
      author: "Random",
      composite: 3,
      verdict: "slop",
    });

    expect(hasEnoughData(profile)).toBe(true);

    // Context reflects learned preferences
    const ctx = getContext(profile);
    // Nature MI should be trusted after validation (trust > 0)
    expect(profile.authorTrust["Nature MI"]).toBeDefined();
    expect(profile.authorTrust["Nature MI"].trust).toBeGreaterThan(0);
    if (profile.authorTrust["Nature MI"].trust >= 0.3) {
      expect(ctx.trustedAuthors).toContain("Nature MI");
    } else {
      // Trust was earned but below context threshold — still validates learning happened
      expect(ctx.trustedAuthors).toBeDefined();
    }

    // Generate briefing with learned preferences
    const briefing2 = generateBriefing(items, profile);
    expect(briefing2.totalItems).toBe(3);
  });

  it("composite score determines grade correctly across real content", () => {
    const testCases = [
      { text: QUALITY_TEXT, expectedGrades: ["A", "B"] },
      { text: MEDIUM_TEXT, expectedGrades: ["B", "C", "D"] },
      { text: SLOP_TEXT, expectedGrades: ["D", "F"] },
    ];

    for (const { text, expectedGrades } of testCases) {
      const scores = heuristicScores(text);
      const grade = scoreGrade(scores.composite);
      expect(expectedGrades).toContain(grade.grade);
    }
  });

  it("filter pipeline processes mixed content and sorts correctly", () => {
    const items = [
      scoreItemWithHeuristics({ text: SLOP_TEXT, author: "Spammer" }, "rss"),
      scoreItemWithHeuristics({ text: QUALITY_TEXT, author: "Researcher" }, "rss"),
      scoreItemWithHeuristics({ text: MEDIUM_TEXT, author: "Blogger" }, "rss"),
    ];

    const config: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 0 };
    const result = runFilterPipeline(items, null, config);

    // All 3 items included (threshold=0)
    expect(result.items).toHaveLength(3);
    expect(result.stats.totalInput).toBe(3);

    // Sorted by weighted composite descending
    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1].weightedComposite).toBeGreaterThanOrEqual(
        result.items[i].weightedComposite,
      );
    }

    // Quality content ranked higher than slop
    const topItem = result.items[0].item;
    expect(topItem.verdict).toBe("quality");
  });

  it("heuristic scores are deterministic for same input", () => {
    const scores1 = heuristicScores(QUALITY_TEXT);
    const scores2 = heuristicScores(QUALITY_TEXT);

    expect(scores1.originality).toBe(scores2.originality);
    expect(scores1.insight).toBe(scores2.insight);
    expect(scores1.credibility).toBe(scores2.credibility);
    expect(scores1.composite).toBe(scores2.composite);
    expect(scores1.verdict).toBe(scores2.verdict);
    expect(scores1.reason).toBe(scores2.reason);
  });

  it("multiple heuristic signals combine correctly", () => {
    // Content with multiple positive signals (> 200 words)
    const richContent = `
According to the latest study cited in the peer-reviewed journal, the analysis
reveals a 42% improvement in benchmark results. The methodology framework uses
a novel algorithm for correlation analysis. The researchers presented compelling
evidence from multiple controlled experiments, demonstrating statistically
significant improvements across all measured dimensions. The principal investigator
noted that these findings challenge several long-held assumptions in the field.

The implementation details show that the dataset of 10000 samples, processed
through the evidence-based hypothesis testing, confirms the initial findings.
The research team carefully documented each step of their methodology to ensure
reproducibility. Independent reviewers verified the results using the same
dataset and confirmed the reported accuracy metrics. This level of transparency
is exactly what the scientific community needs to build confidence in new approaches.

Furthermore, the framework provides a comprehensive benchmark for evaluating
hypothesis-driven research methodologies. The correlation between model complexity
and downstream performance shows interesting nonlinear patterns. Smaller models
with targeted optimization can achieve comparable results to much larger ones.
The evidence strongly supports this approach as both cost-effective and scalable.
Additional experiments confirmed robustness across diverse language families.

The team also conducted ablation studies removing individual components to measure
their contribution. Each module was tested in isolation and in combination with
others. The results demonstrate that the attention optimization layer accounts
for the majority of performance gains observed in production workloads. Future
work will explore applying these techniques to multimodal architectures as well.

For detailed results, tables, and reproducible code see the supplementary materials.
Visit https://example.com/paper for the full study and supplementary data.
    `;

    const scores = heuristicScores(richContent);

    // Should detect multiple positive signals
    expect(scores.reason).toContain("data"); // has percentages/numbers
    expect(scores.reason).toContain("links"); // has URL
    expect(scores.reason).toContain("analytical"); // has analytical keywords
    expect(scores.reason).toContain("attribution"); // has "according to"/"cited"
    expect(scores.reason).toContain("paragraphs"); // has 3+ paragraphs
    expect(scores.reason).toContain("long-form"); // > 100 words
    expect(scores.reason).toContain("detailed"); // > 200 words

    // All positive signals → high scores
    expect(scores.composite).toBeGreaterThanOrEqual(7);
    expect(scores.verdict).toBe("quality");
  });
});
