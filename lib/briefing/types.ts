import type { ContentItem } from "@/lib/types/content";

export type BriefingClassification = "familiar" | "novel" | "mixed";

export interface BriefingItem {
  item: ContentItem;
  briefingScore: number;
  isSerendipity: boolean;
  classification: BriefingClassification;
}

export interface BriefingState {
  priority: BriefingItem[];
  serendipity: BriefingItem | null;
  filteredOut: ContentItem[];
  totalItems: number;
  generatedAt: number;
}
