import type { ContentItem } from "@/lib/types/content";

export function isDuplicateItem(item: ContentItem, existing: ContentItem[]): boolean {
  return existing.some(c =>
    (item.sourceUrl && c.sourceUrl === item.sourceUrl) ||
    (!item.sourceUrl && c.text === item.text),
  );
}
