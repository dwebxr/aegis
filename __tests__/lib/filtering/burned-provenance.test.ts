/**
 * Tests for Feature 10 (transparency UI) backend additions:
 * - findMatchingBurnRule returns the matched rule (not just a bool).
 * - runFilterPipeline populates stats.burnedByRule with itemId+ruleId+field+pattern.
 * - runFilterPipeline populates stats.burnedByThreshold with item IDs dropped by composite < threshold.
 */

import { findMatchingBurnRule, matchesCustomBurnRule } from "@/lib/filtering/customRules";
import { runFilterPipeline } from "@/lib/filtering/pipeline";
import type { ContentItem } from "@/lib/types/content";
import type { CustomFilterRule } from "@/lib/preferences/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "owner",
    author: "Test Author",
    avatar: "T",
    text: "test text",
    source: "rss",
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

describe("findMatchingBurnRule", () => {
  it("returns the rule object on match", () => {
    const item = makeItem({ author: "SpamBot" });
    const rule = makeRule({ id: "r-spam", field: "author", pattern: "SpamBot" });
    expect(findMatchingBurnRule(item, [rule])).toBe(rule);
  });

  it("returns null when no rule matches", () => {
    const item = makeItem({ author: "Goodguy" });
    expect(findMatchingBurnRule(item, [makeRule({ pattern: "SpamBot" })])).toBeNull();
  });

  it("returns the FIRST matching rule when multiple match", () => {
    const item = makeItem({ author: "SpamBot", text: "buy crypto now" });
    const r1 = makeRule({ id: "r-author", field: "author", pattern: "SpamBot" });
    const r2 = makeRule({ id: "r-title", field: "title", pattern: "crypto" });
    expect(findMatchingBurnRule(item, [r1, r2])).toBe(r1);
    expect(findMatchingBurnRule(item, [r2, r1])).toBe(r2);
  });

  it("matchesCustomBurnRule remains a thin wrapper returning bool", () => {
    expect(matchesCustomBurnRule(makeItem({ author: "X" }), [makeRule({ pattern: "X" })])).toBe(true);
    expect(matchesCustomBurnRule(makeItem({ author: "X" }), [makeRule({ pattern: "Y" })])).toBe(false);
  });
});

describe("runFilterPipeline — burnedByRule provenance", () => {
  it("records itemId, ruleId, field, pattern for each custom-rule burn", () => {
    const items = [
      makeItem({ id: "a", author: "SpamBot", scores: { originality: 5, insight: 5, credibility: 5, composite: 9 } }),
      makeItem({ id: "b", author: "Trustworthy", scores: { originality: 5, insight: 5, credibility: 5, composite: 9 } }),
      makeItem({ id: "c", author: "OtherSpam", text: "buy crypto now", scores: { originality: 5, insight: 5, credibility: 5, composite: 9 } }),
    ];
    const rules = [
      makeRule({ id: "rule-spam", field: "author", pattern: "SpamBot" }),
      makeRule({ id: "rule-crypto", field: "title", pattern: "crypto" }),
    ];
    const result = runFilterPipeline(items, null, {
      mode: "lite", wotEnabled: false, qualityThreshold: 4.0, customRules: rules,
    });
    expect(result.stats.customRulesBurned).toBe(2);
    expect(result.stats.burnedByRule).toHaveLength(2);
    expect(result.stats.burnedByRule).toContainEqual({
      itemId: "a", ruleId: "rule-spam", field: "author", pattern: "SpamBot",
    });
    expect(result.stats.burnedByRule).toContainEqual({
      itemId: "c", ruleId: "rule-crypto", field: "title", pattern: "crypto",
    });
    // Item b passed through.
    expect(result.items.map(fi => fi.item.id)).toEqual(["b"]);
  });

  it("returns empty burnedByRule when no custom rules configured", () => {
    const items = [makeItem({ id: "a", scores: { originality: 5, insight: 5, credibility: 5, composite: 9 } })];
    const result = runFilterPipeline(items, null, {
      mode: "lite", wotEnabled: false, qualityThreshold: 4.0,
    });
    expect(result.stats.burnedByRule).toEqual([]);
    expect(result.stats.customRulesBurned).toBe(0);
  });

  it("returns empty burnedByRule when rules configured but none match", () => {
    const items = [makeItem({ id: "a", author: "Cleanguy", scores: { originality: 5, insight: 5, credibility: 5, composite: 9 } })];
    const result = runFilterPipeline(items, null, {
      mode: "lite", wotEnabled: false, qualityThreshold: 4.0,
      customRules: [makeRule({ pattern: "DifferentName" })],
    });
    expect(result.stats.burnedByRule).toEqual([]);
  });
});

describe("runFilterPipeline — burnedByThreshold provenance", () => {
  it("records item IDs dropped by composite < threshold", () => {
    const items = [
      makeItem({ id: "a", scores: { originality: 5, insight: 5, credibility: 5, composite: 9 } }),
      makeItem({ id: "b", scores: { originality: 5, insight: 5, credibility: 5, composite: 2.5 } }),
      makeItem({ id: "c", scores: { originality: 5, insight: 5, credibility: 5, composite: 1.0 } }),
    ];
    const result = runFilterPipeline(items, null, {
      mode: "lite", wotEnabled: false, qualityThreshold: 4.0,
    });
    expect(result.stats.burnedByThreshold).toEqual(["b", "c"]);
    expect(result.items.map(fi => fi.item.id)).toEqual(["a"]);
  });

  it("does not record threshold burn for items already burned by custom rule", () => {
    const items = [
      // Burned by rule (would also be below threshold without rule).
      makeItem({ id: "a", author: "SpamBot", scores: { originality: 1, insight: 1, credibility: 1, composite: 1 } }),
      // Burned by threshold only.
      makeItem({ id: "b", author: "Cleanguy", scores: { originality: 1, insight: 1, credibility: 1, composite: 1 } }),
    ];
    const result = runFilterPipeline(items, null, {
      mode: "lite", wotEnabled: false, qualityThreshold: 4.0,
      customRules: [makeRule({ pattern: "SpamBot" })],
    });
    expect(result.stats.burnedByRule.map(b => b.itemId)).toEqual(["a"]);
    expect(result.stats.burnedByThreshold).toEqual(["b"]);
  });

  it("returns empty burnedByThreshold when all items pass", () => {
    const items = [makeItem({ id: "a", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } })];
    const result = runFilterPipeline(items, null, {
      mode: "lite", wotEnabled: false, qualityThreshold: 4.0,
    });
    expect(result.stats.burnedByThreshold).toEqual([]);
  });
});
