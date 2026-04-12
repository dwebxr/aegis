import { scoredItemFields } from "@/lib/types/content";
import type { ScoringEngine } from "@/lib/scoring/types";

describe("scoredItemFields", () => {
  it("extracts score breakdown from result", () => {
    const fields = scoredItemFields({
      originality: 8, insight: 7, credibility: 9, composite: 8,
      verdict: "quality", reason: "Good analysis",
    });
    expect(fields.scores).toEqual({
      originality: 8, insight: 7, credibility: 9, composite: 8,
    });
    expect(fields.verdict).toBe("quality");
    expect(fields.reason).toBe("Good analysis");
  });

  it("sets default state fields", () => {
    const fields = scoredItemFields({
      originality: 5, insight: 5, credibility: 5, composite: 5,
      verdict: "slop", reason: "Low quality",
    });
    expect(fields.validated).toBe(false);
    expect(fields.flagged).toBe(false);
    expect(fields.timestamp).toBe("just now");
    expect(fields.createdAt).toBeGreaterThan(0);
    expect(fields.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("passes through optional VCL fields when present", () => {
    const fields = scoredItemFields({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "test",
      vSignal: 8.2, cContext: 3.1, lSlop: 1.5,
      topics: ["ai", "ml"],
    });
    expect(fields.vSignal).toBe(8.2);
    expect(fields.cContext).toBe(3.1);
    expect(fields.lSlop).toBe(1.5);
    expect(fields.topics).toEqual(["ai", "ml"]);
  });

  it("leaves optional fields undefined when not provided", () => {
    const fields = scoredItemFields({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "test",
    });
    expect(fields.vSignal).toBeUndefined();
    expect(fields.cContext).toBeUndefined();
    expect(fields.lSlop).toBeUndefined();
    expect(fields.topics).toBeUndefined();
    expect(fields.scoringEngine).toBeUndefined();
  });

  it("sets scoredByAI=true for non-heuristic engines", () => {
    const engines: ScoringEngine[] = ["claude-server", "claude-byok", "claude-ic", "ollama", "webllm", "mediapipe"];
    for (const engine of engines) {
      const fields = scoredItemFields({
        originality: 7, insight: 7, credibility: 7, composite: 7,
        verdict: "quality", reason: "test",
        scoringEngine: engine,
      });
      expect(fields.scoredByAI).toBe(true);
      expect(fields.scoringEngine).toBe(engine);
    }
  });

  it("sets scoredByAI=false for heuristic engine", () => {
    const fields = scoredItemFields({
      originality: 5, insight: 5, credibility: 5, composite: 5,
      verdict: "slop", reason: "Heuristic fallback",
      scoringEngine: "heuristic",
    });
    expect(fields.scoredByAI).toBe(false);
    expect(fields.scoringEngine).toBe("heuristic");
  });

  it("sets scoredByAI=true when scoringEngine is undefined (legacy)", () => {
    const fields = scoredItemFields({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "test",
    });
    // undefined !== "heuristic" → true
    expect(fields.scoredByAI).toBe(true);
  });

  it("handles boundary score values (0 and 10)", () => {
    const fields = scoredItemFields({
      originality: 0, insight: 0, credibility: 0, composite: 0,
      verdict: "slop", reason: "Zero scores",
    });
    expect(fields.scores.originality).toBe(0);
    expect(fields.scores.composite).toBe(0);

    const maxFields = scoredItemFields({
      originality: 10, insight: 10, credibility: 10, composite: 10,
      verdict: "quality", reason: "Perfect",
    });
    expect(maxFields.scores.originality).toBe(10);
  });

  it("handles fractional composite scores", () => {
    const fields = scoredItemFields({
      originality: 7.5, insight: 6.3, credibility: 8.1, composite: 7.3,
      verdict: "quality", reason: "test",
    });
    expect(fields.scores.composite).toBe(7.3);
    expect(fields.scores.originality).toBe(7.5);
  });

  it("handles empty topics array", () => {
    const fields = scoredItemFields({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "test",
      topics: [],
    });
    expect(fields.topics).toEqual([]);
  });

  it("preserves empty reason string", () => {
    const fields = scoredItemFields({
      originality: 7, insight: 7, credibility: 7, composite: 7,
      verdict: "quality", reason: "",
    });
    expect(fields.reason).toBe("");
  });

  it("can be spread into a ContentItem-shaped object", () => {
    const fields = scoredItemFields({
      originality: 8, insight: 7, credibility: 9, composite: 8,
      verdict: "quality", reason: "Good",
      topics: ["tech"], scoringEngine: "claude-server",
    });
    const item = {
      id: "test-id",
      owner: "",
      author: "Test",
      avatar: "T",
      text: "Hello",
      source: "manual" as const,
      ...fields,
    };
    expect(item.id).toBe("test-id");
    expect(item.scores.composite).toBe(8);
    expect(item.scoredByAI).toBe(true);
    expect(item.validated).toBe(false);
  });
});
