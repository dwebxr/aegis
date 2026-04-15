import type { ContentItem, Verdict } from "@/lib/types/content";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import type { BriefingState } from "@/lib/briefing/types";

export interface ContentState {
  content: ContentItem[];
  isAnalyzing: boolean;
  syncStatus: "idle" | "syncing" | "synced" | "offline";
  /** True once the local cache has been checked (IDB/localStorage). */
  cacheChecked: boolean;
  analyze: (text: string, userContext?: UserContext | null, meta?: { sourceUrl?: string; imageUrl?: string }) => Promise<AnalyzeResponse>;
  /** Run the full scoring cascade without side effects (no state update, no IC save). Used by scheduler. */
  scoreText: (text: string, userContext?: UserContext | null) => Promise<AnalyzeResponse>;
  validateItem: (id: string) => void;
  flagItem: (id: string) => void;
  addContent: (item: ContentItem) => void;
  /** Buffer a new item for later display (used by scheduler). */
  addContentBuffered: (item: ContentItem) => void;
  /** Move all buffered items into visible content. */
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
