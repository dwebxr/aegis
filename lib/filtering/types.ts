import type { ContentItem } from "@/lib/types/content";
import type { WoTScore } from "@/lib/wot/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

export type FilterMode = "lite" | "pro";

export interface FilterConfig {
  mode: FilterMode;
  wotEnabled: boolean;
  qualityThreshold: number;
  profile?: UserPreferenceProfile;
}

export interface FilteredItem {
  item: ContentItem;
  wotScore: WoTScore | null;
  weightedComposite: number;
  isWoTSerendipity: boolean;
  isContentSerendipity: boolean;
}

export interface FilterPipelineResult {
  items: FilteredItem[];
  stats: FilterPipelineStats;
}

export interface FilterPipelineStats {
  totalInput: number;
  wotScoredCount: number;
  aiScoredCount: number;
  serendipityCount: number;
  estimatedAPICost: number;
  mode: FilterMode;
}

export type { SerendipityItem, DiscoveryType } from "./serendipity";
