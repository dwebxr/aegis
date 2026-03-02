import type { ContentItem } from "@/lib/types/content";
import type { CustomFilterRule } from "@/lib/preferences/types";

/**
 * Returns true if any custom burn rule matches the item.
 * Author rules: case-insensitive exact match.
 * Title rules: case-insensitive substring match against item.text.
 */
export function matchesCustomBurnRule(
  item: ContentItem,
  rules: CustomFilterRule[],
): boolean {
  return rules.some(rule => {
    switch (rule.field) {
      case "author":
        return item.author.toLowerCase() === rule.pattern.toLowerCase();
      case "title":
        return item.text.toLowerCase().includes(rule.pattern.toLowerCase());
      default:
        return false;
    }
  });
}
