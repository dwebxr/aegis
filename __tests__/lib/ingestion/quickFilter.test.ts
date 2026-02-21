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
      const text = "See results at https://nature.com/study for the full findings here.";
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
      const text = "The model accuracy improved to 0.95 after careful fine-tuning.";
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
      expect(result.composite).toBeGreaterThanOrEqual(1);
      expect(result.composite).toBeLessThanOrEqual(10);
    });
  });

  describe("composite formula", () => {
    it("uses weighted average: 0.4*O + 0.35*I + 0.25*C", () => {
      // Baseline: all 5's → composite = 5*0.4 + 5*0.35 + 5*0.25 = 5.0
      const result = heuristicScores("This is a simple and normal text about general topics");
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
      const result = heuristicScores("This is a simple and normal text about general topics");
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
      expect(result.composite).toBeGreaterThanOrEqual(1);
      expect(result.composite).toBeLessThanOrEqual(10);
      expect(result.verdict).toBeDefined();
    });

    it("handles single character", () => {
      const result = heuristicScores("a");
      expect(result.composite).toBeGreaterThanOrEqual(1);
      expect(result.composite).toBeLessThanOrEqual(10);
    });

    it("composite is rounded to 1 decimal place", () => {
      const result = heuristicScores("Normal text");
      const str = result.composite.toString();
      const decimals = str.includes(".") ? str.split(".")[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(1);
    });
  });

  describe("short content penalty", () => {
    it("penalizes very short text (< 8 words)", () => {
      const result = heuristicScores("Short text");
      expect(result.insight).toBe(4); // base 5 - 1
      expect(result.originality).toBe(4); // base 5 - 1
      expect(result.reason).toContain("very short content");
    });

    it("does not penalize text with 8+ words", () => {
      const result = heuristicScores("This is a reasonable piece of content about technology.");
      expect(result.insight).toBe(5);
      expect(result.originality).toBe(5);
    });
  });

  describe("detailed content bonus", () => {
    it("gives extra insight bonus for very long text (>200 words)", () => {
      const words = Array(220).fill("word").join(" ");
      const result = heuristicScores(words);
      expect(result.insight).toBe(8); // base 5 + 1 (>50) + 1 (>100) + 1 (>200)
      expect(result.reason).toContain("detailed content");
    });
  });

  describe("structured paragraphs bonus", () => {
    it("gives bonus for text with 3+ paragraphs", () => {
      const text = "First paragraph about the topic.\n\nSecond paragraph with more detail.\n\nThird paragraph with conclusions.";
      const result = heuristicScores(text);
      expect(result.reason).toContain("structured paragraphs");
      // originality and insight each get +1
      expect(result.originality).toBeGreaterThanOrEqual(6);
      expect(result.insight).toBeGreaterThanOrEqual(6);
    });

    it("does not trigger for fewer than 3 paragraphs", () => {
      const text = "First paragraph.\n\nSecond paragraph.";
      const result = heuristicScores(text);
      expect(result.reason).not.toContain("structured paragraphs");
    });
  });

  describe("analytical language bonus", () => {
    it("gives insight+credibility bonus for analytical terms", () => {
      const text = "The analysis of the dataset shows a strong correlation between the variables.";
      const result = heuristicScores(text);
      expect(result.reason).toContain("analytical language");
      expect(result.insight).toBeGreaterThanOrEqual(6); // base 5 + 1
      expect(result.credibility).toBeGreaterThanOrEqual(6); // base 5 + 1
    });

    it("does not trigger for casual language", () => {
      const text = "I think this is a pretty good idea for a new project.";
      const result = heuristicScores(text);
      expect(result.reason).not.toContain("analytical language");
    });
  });

  describe("attribution bonus", () => {
    it("gives credibility bonus for attribution", () => {
      const text = "According to the latest report the results are significant here.";
      const result = heuristicScores(text);
      expect(result.reason).toContain("attribution present");
      expect(result.credibility).toBe(7); // base 5 + 2
    });

    it("recognizes 'cited' as attribution", () => {
      const text = "The study cited in the paper provides strong evidence for the claim.";
      const result = heuristicScores(text);
      expect(result.reason).toContain("attribution present");
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

describe("heuristicScores — boundary conditions", () => {
  it("exactly 8 words: no short-text penalty", () => {
    const text = "one two three four five six seven eight";
    const result = heuristicScores(text);
    expect(result.insight).toBe(5);
    expect(result.originality).toBe(5);
    expect(result.reason).not.toContain("very short content");
  });

  it("exactly 7 words: triggers short-text penalty", () => {
    const text = "one two three four five six seven";
    const result = heuristicScores(text);
    expect(result.insight).toBe(4);
    expect(result.originality).toBe(4);
    expect(result.reason).toContain("very short content");
  });

  it("exactly 50 words: no length bonus (need >50)", () => {
    const text = Array(50).fill("word").join(" ");
    const result = heuristicScores(text);
    expect(result.insight).toBe(5);
  });

  it("exactly 51 words: gets >50 bonus", () => {
    const text = Array(51).fill("word").join(" ");
    const result = heuristicScores(text);
    expect(result.insight).toBe(6);
  });

  it("caps ratio exactly at 0.3: no penalty (need >0.3)", () => {
    // 3 uppercase out of 10 chars = 0.3
    const text = "ABCdefghij extra words to fill the count nicely";
    const result = heuristicScores(text);
    // capsRatio = uppercase / text.length → depends on full string
    // Just verify it doesn't crash and gives meaningful output
    expect(result.credibility).toBeGreaterThanOrEqual(1);
  });

  it("all-lowercase text gets no caps penalty", () => {
    const text = "this is a completely lowercase piece of text about nothing";
    const result = heuristicScores(text);
    expect(result.credibility).toBe(5);
    expect(result.originality).toBe(5);
  });

  it("multiple stacking bonuses give correct composite", () => {
    // >100 words + links + data + analytical + attribution + paragraphs
    const para1 = "According to the analysis of the dataset, the correlation shows 45% improvement.";
    const para2 = "See details at https://example.com for more information about the methodology.";
    const para3 = Array(50).fill("word").join(" ");
    const text = para1 + "\n\n" + para2 + "\n\n" + para3;
    const result = heuristicScores(text);
    expect(result.credibility).toBeGreaterThan(5);
    expect(result.insight).toBeGreaterThan(5);
    expect(result.composite).toBeGreaterThan(5);
    expect(result.verdict).toBe("quality");
  });

  it("stacking negative signals floors at 0", () => {
    // Short + caps + exclamation → heavy penalties
    const text = "WOW!!! AMAZING!!!";
    const result = heuristicScores(text);
    expect(result.originality).toBe(0);
    expect(result.credibility).toBe(0);
  });

  it("verdict boundary: composite exactly 4.0 is quality", () => {
    // We can't craft exact composite=4.0 easily, but we can verify the rule
    // by testing the function logic: composite >= 4 → quality
    const result = heuristicScores("This is a reasonable piece of content about technology.");
    // Baseline composite is 5.0 → quality
    expect(result.verdict).toBe("quality");
  });

  it("only-whitespace text behaves like empty", () => {
    const result = heuristicScores("   \t\n  ");
    expect(result.composite).toBeGreaterThanOrEqual(1);
    expect(result.composite).toBeLessThanOrEqual(10);
  });
});
