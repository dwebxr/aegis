import type { ContentItem } from "@/lib/types/content";
import type { CurationGroup } from "./curationGroup";
import { isD2AContent } from "./activity";

const MAX_FEED_ITEMS = 50;

export function buildGroupFeed(
  group: CurationGroup,
  allContent: ContentItem[],
): ContentItem[] {
  const memberSet = new Set(group.members);
  const topicSet = group.topics.length > 0 ? new Set(group.topics) : null;

  return allContent
    .filter(item => {
      if (!isD2AContent(item)) return false;
      if (!item.nostrPubkey || !memberSet.has(item.nostrPubkey)) return false;
      if (item.verdict !== "quality") return false;
      if (topicSet && (!item.topics || !item.topics.some(t => topicSet.has(t)))) return false;
      return true;
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, MAX_FEED_ITEMS);
}
