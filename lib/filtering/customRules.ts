import type { ContentItem } from "@/lib/types/content";
import type { CustomFilterRule } from "@/lib/preferences/types";

function ruleMatches(item: ContentItem, rule: CustomFilterRule): boolean {
  switch (rule.field) {
    case "author":
      return item.author.toLowerCase() === rule.pattern.toLowerCase();
    case "title":
      return item.text.toLowerCase().includes(rule.pattern.toLowerCase());
    default:
      return false;
  }
}

export function findMatchingBurnRule(
  item: ContentItem,
  rules: CustomFilterRule[],
): CustomFilterRule | null {
  return rules.find(rule => ruleMatches(item, rule)) ?? null;
}

export function matchesCustomBurnRule(
  item: ContentItem,
  rules: CustomFilterRule[],
): boolean {
  return findMatchingBurnRule(item, rules) !== null;
}
