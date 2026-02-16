/**
 * Integration test: scoring cascade through real heuristic path.
 * Verifies that heuristicScores → quickFilter → pipeline forms a coherent chain.
 * The full cascade (Ollama → WebLLM → BYOK → IC → Server → Heuristic) is tested
 * by verifying the heuristic fallback works end-to-end since external services
 * are not available in test environment.
 */
import { heuristicScores, quickSlopFilter } from "@/lib/ingestion/quickFilter";
import { scoreItemWithHeuristics } from "@/lib/filtering/pipeline";
import { runFilterPipeline } from "@/lib/filtering/pipeline";
import { encodeEngineInReason, decodeEngineFromReason } from "@/lib/scoring/types";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";
import type { ContentItem } from "@/lib/types/content";

describe("Scoring cascade integration — heuristic path", () => {
  const qualityArticle = [
    "According to the latest research published by MIT, the new algorithm shows remarkable improvements.",
    "The benchmark results demonstrate a 40% increase in throughput with 95% confidence interval.",
    "The methodology includes cross-validation with five independent datasets spanning three years.",
    "Evidence from the cited source https://example.com/paper supports the hypothesis conclusively.",
    "",
    "The framework implementation uses a novel approach to correlation analysis.",
    "",
    "In conclusion, the experimental evidence strongly validates the proposed optimization strategy.",
  ].join("\n");

  const slopArticle = "WOW!!! 🎉🎉🎉 AMAZING DEAL!!! BUY NOW!!! 💯💯💯";

  it("quality article passes quickSlopFilter → heuristic scores → pipeline", () => {
    // Step 1: Quick filter
    expect(quickSlopFilter(qualityArticle)).toBe(true);

    // Step 2: Full heuristic scoring
    const scores = heuristicScores(qualityArticle);
    expect(scores.verdict).toBe("quality");
    expect(scores.composite).toBeGreaterThan(6);
    expect(scores.reason).toContain("Heuristic");
    expect(scores.reason).toContain("analytical language");
    expect(scores.reason).toContain("contains links");
    expect(scores.reason).toContain("contains data/numbers");

    // Step 3: Pipeline scoring (no WoT)
    const item = scoreItemWithHeuristics({ text: qualityArticle, author: "MIT" }, "rss");
    expect(item.scoringEngine).toBe("heuristic");
    expect(item.scoredByAI).toBe(false);
    expect(item.scores.composite).toBe(scores.composite);

    // Step 4: Pipeline filtering
    const result = runFilterPipeline([item], null, { qualityThreshold: 5.0, wotEnabled: false, mode: "pro" });
    expect(result.items).toHaveLength(1);
    expect(result.stats.aiScoredCount).toBe(0);
    expect(result.stats.estimatedAPICost).toBe(0);
  });

  it("slop article gets filtered out by pipeline threshold", () => {
    const scores = heuristicScores(slopArticle);
    expect(scores.composite).toBeLessThan(5);

    const item = scoreItemWithHeuristics({ text: slopArticle, author: "Spammer" }, "rss");
    const result = runFilterPipeline([item], null, { qualityThreshold: 5.0, wotEnabled: false, mode: "pro" });
    expect(result.items).toHaveLength(0);
  });

  it("engine encoding round-trips through IC persistence path", () => {
    const scores = heuristicScores(qualityArticle);
    const encoded = encodeEngineInReason("heuristic", scores.reason);
    const { engine, cleanReason } = decodeEngineFromReason(encoded);
    expect(engine).toBe("heuristic");
    expect(cleanReason).toBe(scores.reason);
  });
});

describe("parseScoreResponse — real LLM response parsing", () => {
  it("parses well-formed JSON response", () => {
    const raw = JSON.stringify({
      originality: 8,
      insight: 7,
      credibility: 9,
      composite: 8.0,
      verdict: "quality",
      reason: "Strong analytical content",
      topics: ["ai", "research"],
      vSignal: 8,
      cContext: 7,
      lSlop: 2,
    });
    const result = parseScoreResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.originality).toBe(8);
    expect(result!.composite).toBe(8.0);
    expect(result!.verdict).toBe("quality");
    expect(result!.topics).toEqual(["ai", "research"]);
  });

  it("parses JSON wrapped in markdown code fence", () => {
    const raw = '```json\n{"originality":7,"insight":6,"credibility":8,"composite":7.0,"verdict":"quality","reason":"Good","topics":["tech"],"vSignal":7,"cContext":6,"lSlop":3}\n```';
    const result = parseScoreResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.originality).toBe(7);
  });

  it("clamps out-of-range values to [0, 10]", () => {
    const raw = JSON.stringify({
      originality: 15,
      insight: -3,
      credibility: 100,
      composite: 20,
      verdict: "quality",
      reason: "test",
      topics: [],
      vSignal: 50,
      cContext: -10,
      lSlop: 999,
    });
    const result = parseScoreResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.originality).toBe(10);
    expect(result!.insight).toBe(0);
    expect(result!.credibility).toBe(10);
    expect(result!.composite).toBe(10);
    expect(result!.vSignal).toBe(10);
    expect(result!.cContext).toBe(0);
    expect(result!.lSlop).toBe(10);
  });

  it("handles missing fields with defaults", () => {
    const raw = JSON.stringify({ verdict: "slop", reason: "Bad content" });
    const result = parseScoreResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.originality).toBe(5); // default
    expect(result!.insight).toBe(5);
    expect(result!.topics).toEqual([]);
  });

  it("returns null for non-JSON input", () => {
    expect(parseScoreResponse("I don't know how to score this")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseScoreResponse("")).toBeNull();
  });

  it("non-quality verdict defaults to slop", () => {
    const raw = JSON.stringify({ verdict: "unknown" });
    const result = parseScoreResponse(raw);
    expect(result!.verdict).toBe("slop");
  });

  it("truncates long reason to 500 chars", () => {
    const raw = JSON.stringify({
      originality: 5, insight: 5, credibility: 5, composite: 5,
      verdict: "quality",
      reason: "x".repeat(600),
      topics: [],
    });
    const result = parseScoreResponse(raw);
    expect(result!.reason.length).toBeLessThanOrEqual(500);
  });

  it("limits topics to 10", () => {
    const raw = JSON.stringify({
      originality: 5, insight: 5, credibility: 5, composite: 5,
      verdict: "quality", reason: "test",
      topics: Array.from({ length: 20 }, (_, i) => `topic${i}`),
    });
    const result = parseScoreResponse(raw);
    expect(result!.topics).toHaveLength(10);
  });

  it("filters non-string topics", () => {
    const raw = JSON.stringify({
      originality: 5, insight: 5, credibility: 5, composite: 5,
      verdict: "quality", reason: "test",
      topics: ["valid", 123, null, "also-valid", { obj: true }],
    });
    const result = parseScoreResponse(raw);
    expect(result!.topics).toEqual(["valid", "also-valid"]);
  });

  it("derives composite from V/C/L when composite missing", () => {
    const raw = JSON.stringify({
      vSignal: 8, cContext: 6, lSlop: 2,
      verdict: "quality", reason: "test", topics: [],
    });
    const result = parseScoreResponse(raw);
    // composite fallback = (vSignal * cContext) / (lSlop + 0.5) = (8*6)/(2.5) = 19.2 → clamped to 10
    expect(result!.composite).toBe(10);
  });
});

describe("Multi-item pipeline integration", () => {
  it("correctly ranks and filters a mixed set of items", () => {
    const items: ContentItem[] = [
      scoreItemWithHeuristics({
        text: "According to the analysis, the benchmark shows 95% accuracy with detailed methodology and evidence from https://example.com/paper describing the algorithm framework implementation dataset.",
        author: "Researcher",
      }, "rss"),
      scoreItemWithHeuristics({
        text: "BUY NOW!!! 🎉💯 AMAZING!!!",
        author: "Spammer",
      }, "rss"),
      scoreItemWithHeuristics({
        text: "The evidence suggests a correlation between the variables cited in the original source: MIT paper 2024. The hypothesis is supported by the data showing 15% improvement.",
        author: "Analyst",
      }, "rss"),
    ];

    const result = runFilterPipeline(items, null, { qualityThreshold: 4.0, wotEnabled: false, mode: "pro" });

    // Should filter out slop, keep quality items
    const verdicts = result.items.map(i => i.item.verdict);
    expect(verdicts.every(v => v === "quality")).toBe(true);

    // Should be sorted by composite descending
    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1].weightedComposite).toBeGreaterThanOrEqual(result.items[i].weightedComposite);
    }
  });
});
