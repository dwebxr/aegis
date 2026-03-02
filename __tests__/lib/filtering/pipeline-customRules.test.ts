import { runFilterPipeline } from "@/lib/filtering/pipeline";
import type { ContentItem } from "@/lib/types/content";
import type { FilterConfig } from "@/lib/filtering/types";

jest.mock("uuid", () => ({ v4: () => "test-uuid" }));

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "Test Author",
    avatar: "T",
    text: "Quality analysis of Ethereum scaling",
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

const baseConfig: FilterConfig = { mode: "lite", wotEnabled: false, qualityThreshold: 4 };

describe("runFilterPipeline — custom burn rules", () => {
  it("excludes items matching author burn rule", () => {
    const items = [
      makeItem({ id: "a", author: "SpamBot" }),
      makeItem({ id: "b", author: "Legit Writer" }),
    ];
    const config: FilterConfig = {
      ...baseConfig,
      customRules: [{ id: "r1", field: "author", pattern: "SpamBot", createdAt: Date.now() }],
    };
    const result = runFilterPipeline(items, null, config);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item.author).toBe("Legit Writer");
  });

  it("excludes items matching title burn rule", () => {
    const items = [
      makeItem({ id: "a", text: "Bitcoin price prediction 2026" }),
      makeItem({ id: "b", text: "Ethereum governance analysis" }),
    ];
    const config: FilterConfig = {
      ...baseConfig,
      customRules: [{ id: "r1", field: "title", pattern: "price prediction", createdAt: Date.now() }],
    };
    const result = runFilterPipeline(items, null, config);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item.text).toContain("governance");
  });

  it("counts burned items in stats.customRulesBurned", () => {
    const items = [
      makeItem({ id: "a", author: "SpamBot" }),
      makeItem({ id: "b", author: "SpamBot" }),
      makeItem({ id: "c", author: "Legit" }),
    ];
    const config: FilterConfig = {
      ...baseConfig,
      customRules: [{ id: "r1", field: "author", pattern: "SpamBot", createdAt: Date.now() }],
    };
    const result = runFilterPipeline(items, null, config);
    expect(result.stats.customRulesBurned).toBe(2);
    expect(result.items).toHaveLength(1);
  });

  it("does not affect pipeline when no rules provided", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    const result = runFilterPipeline(items, null, baseConfig);
    expect(result.items).toHaveLength(2);
    expect(result.stats.customRulesBurned).toBe(0);
  });

  it("burns items even if above quality threshold", () => {
    const items = [makeItem({ id: "a", author: "SpamBot", scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } })];
    const config: FilterConfig = {
      ...baseConfig,
      customRules: [{ id: "r1", field: "author", pattern: "SpamBot", createdAt: Date.now() }],
    };
    const result = runFilterPipeline(items, null, config);
    expect(result.items).toHaveLength(0);
    expect(result.stats.customRulesBurned).toBe(1);
  });

  it("applies burn rules before quality threshold", () => {
    // Item below threshold + burned by rule → should be counted as burned, not filtered by threshold
    const items = [makeItem({ id: "a", author: "SpamBot", scores: { originality: 2, insight: 2, credibility: 2, composite: 2 } })];
    const config: FilterConfig = {
      ...baseConfig,
      qualityThreshold: 5,
      customRules: [{ id: "r1", field: "author", pattern: "SpamBot", createdAt: Date.now() }],
    };
    const result = runFilterPipeline(items, null, config);
    expect(result.stats.customRulesBurned).toBe(1);
  });

  it("handles empty customRules array same as undefined", () => {
    const items = [makeItem()];
    const config: FilterConfig = { ...baseConfig, customRules: [] };
    const result = runFilterPipeline(items, null, config);
    expect(result.items).toHaveLength(1);
    expect(result.stats.customRulesBurned).toBe(0);
  });

  it("multiple rules work together", () => {
    const items = [
      makeItem({ id: "a", author: "SpamBot", text: "Good article" }),
      makeItem({ id: "b", author: "Legit", text: "Price prediction for BTC" }),
      makeItem({ id: "c", author: "Legit", text: "Good article" }),
    ];
    const config: FilterConfig = {
      ...baseConfig,
      customRules: [
        { id: "r1", field: "author", pattern: "SpamBot", createdAt: Date.now() },
        { id: "r2", field: "title", pattern: "price prediction", createdAt: Date.now() },
      ],
    };
    const result = runFilterPipeline(items, null, config);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item.id).toBe("c");
    expect(result.stats.customRulesBurned).toBe(2);
  });
});
