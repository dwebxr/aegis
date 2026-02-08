import { heuristicScores, quickSlopFilter } from "@/lib/ingestion/quickFilter";

describe("heuristicScores", () => {
  it("returns baseline scores for plain text", () => {
    const result = heuristicScores("This is a reasonable piece of content about technology.");
    expect(result.originality).toBe(5);
    expect(result.insight).toBe(5);
    expect(result.credibility).toBe(5);
    expect(result.composite).toBeCloseTo(5.0);
    expect(result.verdict).toBe("quality");
    expect(result.reason).toContain("Heuristic");
  });

  describe("exclamation density", () => {
    it("penalizes high exclamation density (>0.1)", () => {
      const text = "Wow! Amazing! Incredible! Unbelievable! Check this out!";
      const result = heuristicScores(text);
      expect(result.originality).toBeLessThan(5);
      expect(result.credibility).toBeLessThan(5);
    });

    it("does not penalize normal exclamation usage", () => {
      const text = "This is a great article about a fascinating new discovery in quantum physics research!";
      const result = heuristicScores(text);
      // 1 exclamation in 15 words = 0.067, below 0.1 threshold
      expect(result.originality).toBe(5);
    });
  });

  describe("emoji density", () => {
    it("penalizes high emoji density", () => {
      const text = "Best day ever 🎉🎊🥳 so happy 😊😍🥰 love this 💕❤️";
      const result = heuristicScores(text);
      expect(result.originality).toBeLessThan(5);
    });
  });

  describe("caps ratio", () => {
    it("penalizes high caps ratio (>0.3)", () => {
      const text = "THIS IS ALL CAPS TEXT ABOUT SOMETHING IMPORTANT";
      const result = heuristicScores(text);
      expect(result.credibility).toBeLessThan(5);
      expect(result.originality).toBeLessThan(5);
    });

    it("does not penalize normal mixed case", () => {
      const text = "The research paper by Dr. Smith was published in Nature.";
      const result = heuristicScores(text);
      expect(result.credibility).toBeGreaterThanOrEqual(5);
    });
  });

  describe("content length bonuses", () => {
    it("gives insight bonus for long text (>50 words)", () => {
      const words = Array(60).fill("word").join(" ");
      const result = heuristicScores(words);
      expect(result.insight).toBe(6); // base 5 + 1
    });

    it("gives insight and originality bonus for very long text (>100 words)", () => {
      const words = Array(120).fill("word").join(" ");
      const result = heuristicScores(words);
      expect(result.insight).toBe(7); // base 5 + 1 + 1
      expect(result.originality).toBe(6); // base 5 + 1
    });
  });

  describe("link presence", () => {
    it("gives credibility bonus for text with links", () => {
      const text = "According to https://nature.com/study the findings show X.";
      const result = heuristicScores(text);
      expect(result.credibility).toBe(7); // base 5 + 2
    });
  });

  describe("data presence", () => {
    it("gives insight+credibility bonus for text with data", () => {
      const text = "The stock rose 25% to $140 after earnings.";
      const result = heuristicScores(text);
      expect(result.insight).toBe(7); // base 5 + 2
      expect(result.credibility).toBe(6); // base 5 + 1
    });

    it("recognizes decimal numbers as data", () => {
      const text = "The accuracy improved to 0.95 after fine-tuning.";
      const result = heuristicScores(text);
      expect(result.insight).toBe(7);
    });
  });

  describe("score clamping", () => {
    it("clamps scores to 0-10 range (floor)", () => {
      // Lots of exclamations + caps → severe penalties
      const text = "WOW! AMAZING! INCREDIBLE! UNBELIEVABLE! SHOCKING!";
      const result = heuristicScores(text);
      expect(result.originality).toBeGreaterThanOrEqual(0);
      expect(result.credibility).toBeGreaterThanOrEqual(0);
    });

    it("composite is always 0-10", () => {
      const result = heuristicScores("");
      expect(result.composite).toBeGreaterThanOrEqual(0);
      expect(result.composite).toBeLessThanOrEqual(10);
    });
  });

  describe("composite formula", () => {
    it("uses weighted average: 0.4*O + 0.35*I + 0.25*C", () => {
      // Baseline: all 5's → composite = 5*0.4 + 5*0.35 + 5*0.25 = 5.0
      const result = heuristicScores("Simple normal text here");
      expect(result.composite).toBeCloseTo(5.0, 1);
    });
  });

  describe("verdict", () => {
    it("returns 'quality' for composite >= 4", () => {
      const result = heuristicScores("Decent article about a topic.");
      expect(result.verdict).toBe("quality");
    });

    it("returns 'slop' for composite < 4", () => {
      // High caps + high exclamation → low originality, low credibility
      const text = "OMG!!! BREAKING!!! YOU WON'T BELIEVE THIS!!! CLICK NOW!!!";
      const result = heuristicScores(text);
      expect(result.verdict).toBe("slop");
    });
  });

  describe("reason string", () => {
    it("includes specific signals detected", () => {
      const text = "Check out https://example.com for the data: 42% improvement!";
      const result = heuristicScores(text);
      expect(result.reason).toContain("contains links");
      expect(result.reason).toContain("contains data/numbers");
    });

    it("reports no signals for plain text", () => {
      const result = heuristicScores("Simple normal text here");
      expect(result.reason).toContain("no strong signals");
    });

    it("reports exclamation marks when excessive", () => {
      const result = heuristicScores("Wow! Amazing! Great! Super!");
      expect(result.reason).toContain("exclamation marks");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = heuristicScores("");
      expect(result.composite).toBeGreaterThanOrEqual(0);
      expect(result.verdict).toBeDefined();
    });

    it("handles single character", () => {
      const result = heuristicScores("a");
      expect(result.composite).toBeGreaterThanOrEqual(0);
    });

    it("composite is rounded to 1 decimal place", () => {
      const result = heuristicScores("Normal text");
      const str = result.composite.toString();
      const decimals = str.includes(".") ? str.split(".")[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(1);
    });
  });
});

describe("quickSlopFilter", () => {
  it("returns true for quality content (composite >= threshold)", () => {
    expect(quickSlopFilter("A thoughtful analysis of current events.")).toBe(true);
  });

  it("returns false for low-quality content", () => {
    expect(quickSlopFilter("OMG!!!! AMAZING!!!! WOW!!!!! CLICK NOW!!!!!")).toBe(false);
  });

  it("uses default threshold of 3.5", () => {
    // Normal text → composite ~5.0 > 3.5
    expect(quickSlopFilter("Normal text about things")).toBe(true);
  });

  it("respects custom threshold", () => {
    // Normal text has composite ~5.0
    expect(quickSlopFilter("Normal text", 4.0)).toBe(true);
    expect(quickSlopFilter("Normal text", 6.0)).toBe(false);
  });

  it("threshold 0 passes everything", () => {
    expect(quickSlopFilter("!", 0)).toBe(true);
  });
});
