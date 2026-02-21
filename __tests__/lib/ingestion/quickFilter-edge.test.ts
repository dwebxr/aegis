import { heuristicScores, quickSlopFilter } from "@/lib/ingestion/quickFilter";

describe("heuristicScores — edge cases", () => {
  describe("boundary conditions", () => {
    it("handles empty string", () => {
      const scores = heuristicScores("");
      expect(scores.originality).toBeGreaterThanOrEqual(1);
      expect(scores.insight).toBeGreaterThanOrEqual(1);
      expect(scores.credibility).toBeGreaterThanOrEqual(1);
      expect(scores.composite).toBeGreaterThanOrEqual(1);
    });

    it("handles single word", () => {
      const scores = heuristicScores("hello");
      expect(scores.composite).toBeGreaterThanOrEqual(1);
      expect(scores.composite).toBeLessThanOrEqual(10);
    });

    it("handles exactly 8 words (boundary for 'very short' penalty)", () => {
      const scores = heuristicScores("one two three four five six seven eight");
      // 8 words — should NOT get the "very short content" penalty
      expect(scores.reason).not.toContain("very short");
    });

    it("handles 7 words (below boundary)", () => {
      const scores = heuristicScores("one two three four five six seven");
      expect(scores.reason).toContain("very short");
    });

    it("handles exactly 50 words (insight +1 boundary)", () => {
      const text = Array(51).fill("word").join(" ");
      const scores = heuristicScores(text);
      expect(scores.insight).toBeGreaterThan(5);
    });

    it("handles exactly 100 words (insight +1, originality +1 boundary)", () => {
      const text = Array(101).fill("word").join(" ");
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("long-form");
    });

    it("handles exactly 200 words (detailed content boundary)", () => {
      const text = Array(201).fill("word").join(" ");
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("detailed");
    });
  });

  describe("score clamping", () => {
    it("never returns scores below 0", () => {
      // Maximum negative signals
      const spamText = "BUY NOW!!!! WOW!!!! AMAZING!!!! " +
        Array(20).fill("🔥🚀💰").join(" ") +
        "!!!".repeat(50);
      const scores = heuristicScores(spamText);
      expect(scores.originality).toBeGreaterThanOrEqual(0);
      expect(scores.insight).toBeGreaterThanOrEqual(0);
      expect(scores.credibility).toBeGreaterThanOrEqual(0);
    });

    it("never returns scores above 10", () => {
      // Maximum positive signals
      const qualityText = Array(300).fill("analysis").join(" ") +
        " https://example.com 42% improvement $100 " +
        "according to cited source: methodology hypothesis correlation framework " +
        "\n\nparagraph 1\n\nparagraph 2\n\nparagraph 3\n\nparagraph 4";
      const scores = heuristicScores(qualityText);
      expect(scores.originality).toBeLessThanOrEqual(10);
      expect(scores.insight).toBeLessThanOrEqual(10);
      expect(scores.credibility).toBeLessThanOrEqual(10);
    });
  });

  describe("signal detection", () => {
    it("detects exclamation density > 0.1", () => {
      const text = "great! amazing! wow! incredible! buy! now! super! deal!";
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("exclamation");
    });

    it("does not flag moderate exclamation use", () => {
      const text = "This is a great analysis! The methodology is sound and the results are compelling.";
      const scores = heuristicScores(text);
      expect(scores.reason).not.toContain("exclamation");
    });

    it("detects high emoji density", () => {
      const text = "Check 🔥 this 🚀 out 💰 now 🎉 wow 🌟";
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("emoji");
    });

    it("detects excessive caps", () => {
      const text = "THIS IS ALL CAPS AND SHOULD BE FLAGGED FOR CREDIBILITY";
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("caps");
    });

    it("does not flag normal capitalization", () => {
      const text = "This is a normal sentence with proper capitalization. JavaScript is a programming language.";
      const scores = heuristicScores(text);
      expect(scores.reason).not.toContain("caps");
    });

    it("detects links as positive credibility signal", () => {
      const text = "According to the study at https://example.com/paper, the results show improvement.";
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("links");
    });

    it("detects data/numbers as positive signal", () => {
      const text = "Performance improved by 23% and reduced costs by $50 per unit.";
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("data");
    });

    it("detects structured paragraphs (>=3)", () => {
      const text = "First paragraph about the topic.\n\nSecond paragraph with details.\n\nThird paragraph with conclusions.";
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("paragraphs");
    });

    it("detects analytical language keywords", () => {
      const text = "The analysis shows a correlation between the methodology and improved benchmark results.";
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("analytical");
    });

    it("detects attribution phrases", () => {
      const text = "According to recent research cited in the paper, the evidence supports this hypothesis.";
      const scores = heuristicScores(text);
      expect(scores.reason).toContain("attribution");
    });
  });

  describe("composite calculation", () => {
    it("composite = originality*0.4 + insight*0.35 + credibility*0.25", () => {
      // Use content that gives predictable scores
      const text = "just a simple test sentence";
      const scores = heuristicScores(text);
      const expected = parseFloat((scores.originality * 0.4 + scores.insight * 0.35 + scores.credibility * 0.25).toFixed(1));
      expect(scores.composite).toBe(expected);
    });

    it("verdict is 'quality' when composite >= 4", () => {
      // Long content with links and data should score well
      const text = Array(110).fill("analysis").join(" ") + " https://example.com 42%";
      const scores = heuristicScores(text);
      expect(scores.composite).toBeGreaterThanOrEqual(4);
      expect(scores.verdict).toBe("quality");
    });

    it("verdict is 'slop' when composite < 4", () => {
      const text = "BUY!!! NOW!!! WOW!!! AMAZING!!! INCREDIBLE!!!";
      const scores = heuristicScores(text);
      expect(scores.composite).toBeLessThan(4);
      expect(scores.verdict).toBe("slop");
    });
  });

  describe("Unicode handling", () => {
    it("handles CJK characters without crashing", () => {
      const text = "これは日本語のテストコンテンツです。品質分析とデータ: 42%改善";
      const scores = heuristicScores(text);
      expect(scores.composite).toBeGreaterThanOrEqual(1);
      expect(scores.composite).toBeLessThanOrEqual(10);
    });

    it("counts emojis correctly in mixed Unicode", () => {
      const text = "こんにちは 🔥 世界 🌍 テスト 💡";
      const scores = heuristicScores(text);
      // Should detect emojis despite CJK text
      expect(scores.composite).toBeGreaterThanOrEqual(1);
      expect(scores.composite).toBeLessThanOrEqual(10);
    });

    it("handles RTL text", () => {
      const text = "هذا نص عربي للاختبار مع بيانات: 42% تحسين في الأداء";
      const scores = heuristicScores(text);
      expect(scores.composite).toBeGreaterThanOrEqual(1);
      expect(scores.composite).toBeLessThanOrEqual(10);
    });
  });
});

describe("quickSlopFilter", () => {
  it("returns true for quality content above default threshold (3.5)", () => {
    const text = Array(110).fill("analysis").join(" ") + " https://example.com 42%";
    expect(quickSlopFilter(text)).toBe(true);
  });

  it("returns false for spam below default threshold", () => {
    expect(quickSlopFilter("BUY NOW!!! WOW!!! 🔥🔥🔥")).toBe(false);
  });

  it("respects custom threshold", () => {
    const text = "A short but decent point."; // moderate score
    const scores = heuristicScores(text);

    // With low threshold, should pass
    expect(quickSlopFilter(text, 0)).toBe(true);
    // With high threshold, should fail
    expect(quickSlopFilter(text, 10)).toBe(false);
    // With exact composite threshold
    expect(quickSlopFilter(text, scores.composite)).toBe(true);
  });
});
