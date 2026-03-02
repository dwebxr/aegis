import { matchesCustomBurnRule } from "@/lib/filtering/customRules";
import type { ContentItem } from "@/lib/types/content";
import type { CustomFilterRule } from "@/lib/preferences/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-1",
    owner: "owner",
    author: "Test Author",
    avatar: "T",
    text: "Bitcoin price prediction for 2026",
    source: "rss",
    sourceUrl: "https://example.com/article",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
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
    pattern: "Test Author",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("matchesCustomBurnRule — author rules", () => {
  it("matches exact author name", () => {
    const item = makeItem({ author: "SpamBot" });
    const rules = [makeRule({ field: "author", pattern: "SpamBot" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const item = makeItem({ author: "SpamBot" });
    const rules = [makeRule({ field: "author", pattern: "spambot" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("does not match partial author name", () => {
    const item = makeItem({ author: "SpamBot Pro" });
    const rules = [makeRule({ field: "author", pattern: "SpamBot" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(false);
  });

  it("does not match different author", () => {
    const item = makeItem({ author: "Legit Writer" });
    const rules = [makeRule({ field: "author", pattern: "SpamBot" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(false);
  });

  it("handles empty author gracefully", () => {
    const item = makeItem({ author: "" });
    const rules = [makeRule({ field: "author", pattern: "SpamBot" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(false);
  });
});

describe("matchesCustomBurnRule — title rules", () => {
  it("matches keyword in text", () => {
    const item = makeItem({ text: "Bitcoin price prediction for 2026" });
    const rules = [makeRule({ field: "title", pattern: "price prediction" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const item = makeItem({ text: "PRICE PREDICTION for BTC" });
    const rules = [makeRule({ field: "title", pattern: "price prediction" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("does not match when keyword absent", () => {
    const item = makeItem({ text: "Ethereum scaling roadmap analysis" });
    const rules = [makeRule({ field: "title", pattern: "price prediction" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(false);
  });

  it("matches single word pattern", () => {
    const item = makeItem({ text: "Free airdrop alert for new tokens" });
    const rules = [makeRule({ field: "title", pattern: "airdrop" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("handles empty text", () => {
    const item = makeItem({ text: "" });
    const rules = [makeRule({ field: "title", pattern: "airdrop" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(false);
  });
});

describe("matchesCustomBurnRule — multiple rules", () => {
  it("returns true if any rule matches", () => {
    const item = makeItem({ author: "Legit Writer", text: "Free airdrop claim" });
    const rules = [
      makeRule({ id: "r1", field: "author", pattern: "SpamBot" }),
      makeRule({ id: "r2", field: "title", pattern: "airdrop" }),
    ];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("returns false if no rule matches", () => {
    const item = makeItem({ author: "Legit Writer", text: "Ethereum governance update" });
    const rules = [
      makeRule({ id: "r1", field: "author", pattern: "SpamBot" }),
      makeRule({ id: "r2", field: "title", pattern: "airdrop" }),
    ];
    expect(matchesCustomBurnRule(item, rules)).toBe(false);
  });

  it("returns false for empty rules array", () => {
    const item = makeItem();
    expect(matchesCustomBurnRule(item, [])).toBe(false);
  });
});

describe("matchesCustomBurnRule — edge cases", () => {
  it("matches pattern at start of text", () => {
    const item = makeItem({ text: "Airdrop alert: new tokens" });
    const rules = [makeRule({ field: "title", pattern: "airdrop" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("matches pattern at end of text", () => {
    const item = makeItem({ text: "New tokens via airdrop" });
    const rules = [makeRule({ field: "title", pattern: "airdrop" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("handles special regex characters in pattern literally", () => {
    const item = makeItem({ text: "Price prediction (2026)" });
    const rules = [makeRule({ field: "title", pattern: "(2026)" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(true);
  });

  it("does not match when pattern has extra spaces", () => {
    const item = makeItem({ text: "Price prediction for BTC" });
    const rules = [makeRule({ field: "title", pattern: "price  prediction" })];
    expect(matchesCustomBurnRule(item, rules)).toBe(false);
  });
});
