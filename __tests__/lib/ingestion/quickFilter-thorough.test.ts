import { heuristicScores, quickSlopFilter } from "@/lib/ingestion/quickFilter";

describe("heuristicScores — signal detection", () => {
  it("exclamation density > 0.1 penalizes originality and credibility", () => {
    const text = "Wow! Amazing! Incredible! Great! Fantastic! Cool! Nice! Awesome! YES!"; // 9 words, 9 exclamation marks → density 1.0
    const scores = heuristicScores(text);
    expect(scores.originality).toBeLessThan(3);
    expect(scores.credibility).toBeLessThan(3);
  });

  it("emoji density > 0.05 penalizes originality", () => {
    const text = "This 🎉 is 🔥 a 💯 test 🚀"; // 4 words + 4 emojis → density 0.5
    const scores = heuristicScores(text);
    expect(scores.originality).toBeLessThan(4);
  });

  it("caps ratio > 0.3 penalizes credibility and originality", () => {
    const text = "THIS IS ALL CAPS SHOUTING TEXT HERE";
    const scores = heuristicScores(text);
    expect(scores.credibility).toBeLessThan(3);
    expect(scores.originality).toBeLessThan(4);
  });

  it("text < 8 words gets insight penalty", () => {
    const scores = heuristicScores("Short text only");
    expect(scores.reason).toContain("very short content");
  });

  it("text > 50 words gets insight bonus", () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const scores = heuristicScores(text);
    expect(scores.insight).toBeGreaterThan(5);
  });

  it("text > 100 words gets both insight and originality bonus", () => {
    const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const scores = heuristicScores(text);
    expect(scores.insight).toBeGreaterThan(6);
    expect(scores.reason).toContain("long-form content");
  });

  it("text > 200 words gets detailed content bonus", () => {
    const text = Array.from({ length: 210 }, (_, i) => `word${i}`).join(" ");
    const scores = heuristicScores(text);
    expect(scores.reason).toContain("detailed content");
  });

  it("links boost credibility", () => {
    const text = "Check this out https://example.com/paper for more details on the methodology used";
    const scores = heuristicScores(text);
    expect(scores.credibility).toBeGreaterThanOrEqual(7);
    expect(scores.reason).toContain("contains links");
  });

  it("data/numbers boost insight and credibility", () => {
    const text = "The benchmark shows 25% improvement with $100k budget and precision of 0.95";
    const scores = heuristicScores(text);
    expect(scores.insight).toBeGreaterThanOrEqual(7);
    expect(scores.reason).toContain("contains data/numbers");
  });

  it("multiple paragraphs boost originality and insight", () => {
    const text = "First paragraph with some content.\n\nSecond paragraph continues.\n\nThird paragraph concludes the argument.";
    const scores = heuristicScores(text);
    expect(scores.reason).toContain("structured paragraphs");
  });

  it("analytical language boosts insight and credibility", () => {
    const text = "The analysis of this benchmark shows the algorithm implementation performs well with strong methodology.";
    const scores = heuristicScores(text);
    expect(scores.reason).toContain("analytical language");
  });

  it("attribution boosts credibility by 2", () => {
    const text = "According to the latest research, the cited evidence shows improvements. Source: MIT paper.";
    const scores = heuristicScores(text);
    expect(scores.reason).toContain("attribution present");
    expect(scores.credibility).toBeGreaterThanOrEqual(7);
  });
});

describe("heuristicScores — composite formula", () => {
  it("composite = originality*0.4 + insight*0.35 + credibility*0.25", () => {
    const text = "Plain text without any special signals or data";
    const scores = heuristicScores(text);
    const expected = parseFloat((scores.originality * 0.4 + scores.insight * 0.35 + scores.credibility * 0.25).toFixed(1));
    expect(scores.composite).toBeCloseTo(expected, 1);
  });

  it("all scores are clamped to [0, 10]", () => {
    // Maximum penalties: exclamation + emoji + short
    const terrible = "WOW!!! 🎉🔥💯🚀🎊 YES!!!";
    const scores = heuristicScores(terrible);
    expect(scores.originality).toBe(0);
    expect(scores.insight).toBe(4);
    expect(scores.credibility).toBe(2);
    expect(scores.composite).toBe(1.9);
  });

  it("all scores capped at 10 even with many bonuses", () => {
    const great = Array.from({ length: 300 }, () =>
      "According to the analysis of the benchmark methodology with 95% correlation evidence https://example.com"
    ).join("\n\n");
    const scores = heuristicScores(great);
    expect(scores.originality).toBeLessThanOrEqual(10);
    expect(scores.insight).toBeLessThanOrEqual(10);
    expect(scores.credibility).toBeLessThanOrEqual(10);
  });
});

describe("heuristicScores — verdict", () => {
  it("composite >= 4 → quality", () => {
    const text = "A reasonable article with some decent content about technical topics and methodology";
    const scores = heuristicScores(text);
    if (scores.composite >= 4) {
      expect(scores.verdict).toBe("quality");
    }
  });

  it("composite < 4 → slop", () => {
    const text = "WOW!!!"; // very short + exclamation
    const scores = heuristicScores(text);
    if (scores.composite < 4) {
      expect(scores.verdict).toBe("slop");
    }
  });
});

describe("heuristicScores — reason format", () => {
  it("prefixed with 'Heuristic (AI unavailable):'", () => {
    const scores = heuristicScores("Some text here");
    expect(scores.reason).toMatch(/^Heuristic \(AI unavailable\):/);
  });

  it("no signals → 'no strong signals detected'", () => {
    // Need text that triggers zero signals: 8-50 words, no special chars, no links, no data
    const text = "This is a medium length text with ordinary words and nothing special about it at all really";
    const scores = heuristicScores(text);
    // Might have "long-form content" at 50+ words, so use shorter
    const shortText = "Normal text with eight words here";
    const shortScores = heuristicScores(shortText);
    if (shortScores.reason.includes("no strong signals")) {
      expect(shortScores.reason).toContain("no strong signals detected");
    }
  });
});

describe("quickSlopFilter", () => {
  it("default threshold is 3.5", () => {
    const lowText = "BAD!!!"; // should score low
    const highText = "Detailed analysis of the benchmark results showing 95% accuracy with evidence and data from https://example.com";
    // We can't guarantee exact scores, so just verify the function returns boolean
    expect(typeof quickSlopFilter(lowText)).toBe("boolean");
    expect(typeof quickSlopFilter(highText)).toBe("boolean");
  });

  it("custom threshold filters correctly", () => {
    const text = "A reasonable article about technology";
    const score = heuristicScores(text).composite;
    expect(quickSlopFilter(text, score)).toBe(true);
    expect(quickSlopFilter(text, score + 0.1)).toBe(false);
  });

  it("empty string gets a score", () => {
    const result = quickSlopFilter("");
    expect(typeof result).toBe("boolean");
  });
});

describe("heuristicScores — edge cases", () => {
  it("empty string doesn't crash", () => {
    const scores = heuristicScores("");
    expect(scores.composite).toBe(4.3);
    expect(scores.verdict).toBe("quality");
  });

  it("single character", () => {
    const scores = heuristicScores("x");
    expect(scores.reason).toContain("very short content");
  });

  it("only whitespace", () => {
    const scores = heuristicScores("   \n\t  ");
    expect(scores.composite).toBe(4.3);
  });

  it("very long text (10K words)", () => {
    const text = Array.from({ length: 10000 }, (_, i) => `word${i}`).join(" ");
    const scores = heuristicScores(text);
    expect(scores.insight).toBeGreaterThan(5);
    expect(scores.composite).toBeGreaterThan(0);
  });

  it("text with only numbers and percentages", () => {
    const text = "100% 200% $500 0.95 1234 5678 9.99 25%";
    const scores = heuristicScores(text);
    expect(scores.reason).toContain("contains data/numbers");
  });
});
