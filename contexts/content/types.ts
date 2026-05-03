import type { ContentItem, Verdict } from "@/lib/types/content";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import type { BriefingState } from "@/lib/briefing/types";

/** Sync status for content-tier state (IDB/IC). SourceContext uses a
 *  different variant that includes "error" — keep those separate. */
export type ContentSyncStatus = "idle" | "syncing" | "synced" | "offline";

export interface ContentState {
  content: ContentItem[];
  isAnalyzing: boolean;
  syncStatus: ContentSyncStatus;
  /** True once the local cache has been checked (IDB/localStorage). */
  cacheChecked: boolean;
  analyze: (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }) => Promise<AnalyzeResponse>;
  // Side-effect-free cascade run; used by scheduler.
  scoreText: (text: string, userContext?: UserContext | null) => Promise<AnalyzeResponse>;
  validateItem: (id: string) => void;
  flagItem: (id: string) => void;
  addContent: (item: ContentItem) => void;
  addContentBuffered: (item: ContentItem) => void;
  flushPendingItems: () => void;
  pendingCount: number;
  clearDemoContent: () => void;
  loadFromIC: () => Promise<void>;
  syncBriefing: (state: BriefingState, nostrPubkey?: string | null) => void;
  patchItem: (id: string, patch: Partial<ContentItem>) => void;
  actorRef: React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;
  pendingActions: number;
  isOnline: boolean;
}

export type PreferenceCallbacks = {
  onValidate?: (topics: string[], author: string, composite: number, verdict: Verdict, sourceUrl?: string, itemId?: string) => void;
  onFlag?: (topics: string[], author: string, composite: number, verdict: Verdict, itemId?: string) => void;
};
