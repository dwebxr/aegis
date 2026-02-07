import type { ContentItem } from "@/lib/types/content";

export interface BriefingItem {
  item: ContentItem;
  briefingScore: number;
  isSerendipity: boolean;
}

export interface BriefingState {
  priority: BriefingItem[];
  serendipity: BriefingItem | null;
  filteredOut: ContentItem[];
  totalItems: number;
  generatedAt: number;
}
