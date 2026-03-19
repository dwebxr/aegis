import { matchesCustomBurnRule } from "@/lib/filtering/customRules";
import type { ContentItem } from "@/lib/types/content";
import type { CustomFilterRule } from "@/lib/preferences/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test",
    owner: "",
    author: "Test Author",
    avatar: "T",
    text: "Test content about technology",
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

function makeRule(overrides: Partial<CustomFilterRule> = {}): CustomFilterRule {
  return {
    id: "rule-1",
    field: "author",
    pattern: "SpamBot",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("matchesCustomBurnRule — author rules", () => {
  it("matches exact author (case-insensitive)", () => {
    const item = makeItem({ author: "SpamBot" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "author", pattern: "spambot" })])).toBe(true);
    expect(matchesCustomBurnRule(item, [makeRule({ field: "author", pattern: "SPAMBOT" })])).toBe(true);
  });

  it("does NOT match partial author name", () => {
    const item = makeItem({ author: "SpamBot Pro" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "author", pattern: "SpamBot" })])).toBe(false);
  });

  it("does NOT match substring of author", () => {
    const item = makeItem({ author: "MySpamBotAccount" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "author", pattern: "SpamBot" })])).toBe(false);
  });

  it("matches empty author against empty pattern", () => {
    const item = makeItem({ author: "" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "author", pattern: "" })])).toBe(true);
  });

  it("does NOT match empty pattern against non-empty author", () => {
    const item = makeItem({ author: "Real Author" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "author", pattern: "" })])).toBe(false);
  });

  it("handles author with special characters", () => {
    const item = makeItem({ author: "user@domain.com" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "author", pattern: "user@domain.com" })])).toBe(true);
  });

  it("handles author with unicode", () => {
    const item = makeItem({ author: "テストユーザー" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "author", pattern: "テストユーザー" })])).toBe(true);
  });
});

describe("matchesCustomBurnRule — title rules", () => {
  it("matches substring in text (case-insensitive)", () => {
    const item = makeItem({ text: "Bitcoin Price Prediction 2026" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "title", pattern: "price prediction" })])).toBe(true);
  });

  it("matches at beginning of text", () => {
    const item = makeItem({ text: "BREAKING: market crash" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "title", pattern: "breaking" })])).toBe(true);
  });

  it("matches at end of text", () => {
    const item = makeItem({ text: "Analysis of the latest scam" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "title", pattern: "scam" })])).toBe(true);
  });

  it("empty pattern matches any text", () => {
    const item = makeItem({ text: "Any content" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "title", pattern: "" })])).toBe(true);
  });

  it("empty text matches only empty pattern", () => {
    const item = makeItem({ text: "" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "title", pattern: "" })])).toBe(true);
    expect(matchesCustomBurnRule(item, [makeRule({ field: "title", pattern: "something" })])).toBe(false);
  });

  it("handles regex-like characters in pattern literally", () => {
    // patterns are plain strings, not regex
    const item = makeItem({ text: "price is $100.00 (USD)" });
    expect(matchesCustomBurnRule(item, [makeRule({ field: "title", pattern: "$100.00" })])).toBe(true);
  });
});

describe("matchesCustomBurnRule — unknown field", () => {
  it("returns false for unknown field type", () => {
    const item = makeItem();
    const rule = makeRule({ field: "unknown" as CustomFilterRule["field"] });
    expect(matchesCustomBurnRule(item, [rule])).toBe(false);
  });
});

describe("matchesCustomBurnRule — multiple rules", () => {
  it("returns true if ANY rule matches (OR logic)", () => {
    const item = makeItem({ author: "SpamBot", text: "Good content" });
    const rules = [
      makeRule({ field: "title", pattern: "price prediction" }),
      makeRule({ field: "author", pattern: "SpamBot" }),
    ];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("returns false if NO rules match", () => {
    const item = makeItem({ author: "Legit", text: "Quality analysis" });
    const rules = [
      makeRule({ field: "title", pattern: "scam" }),
      makeRule({ field: "author", pattern: "SpamBot" }),
    ];
    expect(matchesCustomBurnRule(item, rules)).toBe(false);
  });

  it("returns false for empty rules array", () => {
    const item = makeItem();
    expect(matchesCustomBurnRule(item, [])).toBe(false);
  });
});
