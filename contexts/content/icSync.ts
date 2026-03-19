import * as Sentry from "@sentry/nextjs";
import type { ContentItem } from "@/lib/types/content";
import type { _SERVICE, ContentSource } from "@/lib/ic/declarations";
import { relativeTime } from "@/lib/utils/scores";
import { errMsg, errMsgShort, handleICSessionError } from "@/lib/utils/errors";
import { withTimeout } from "@/lib/utils/timeout";
import { encodeEngineInReason, decodeEngineFromReason, encodeTopicsInReason, decodeTopicsFromReason } from "@/lib/scoring/types";
import { enqueueAction, dequeueAll, removeAction, incrementRetries } from "@/lib/offline/actionQueue";

const SOURCE_KEYS = ["rss", "url", "twitter", "nostr", "manual"] as const;

export function mapSource(s: string): ContentSource {
  const key = SOURCE_KEYS.includes(s as typeof SOURCE_KEYS[number]) ? s : "manual";
  return { [key]: null } as ContentSource;
}

function mapSourceBack(s: ContentSource): string {
  return SOURCE_KEYS.find(k => k in s) || "manual";
}

export function toICEvaluation(c: ContentItem, owner: import("@dfinity/principal").Principal) {
  return {
    id: c.id,
    owner,
    author: c.author,
    avatar: c.avatar,
    text: c.text,
    source: mapSource(c.source),
    sourceUrl: c.sourceUrl ? [c.sourceUrl] as [string] : [] as [],
    imageUrl: c.imageUrl ? [c.imageUrl] as [string] : [] as [],
    scores: {
      originality: Math.round(c.scores.originality),
      insight: Math.round(c.scores.insight),
      credibility: Math.round(c.scores.credibility),
      compositeScore: c.scores.composite,
    },
    verdict: c.verdict === "quality" ? { quality: null } : { slop: null },
    reason: encodeTopicsInReason(
      c.scoringEngine ? encodeEngineInReason(c.scoringEngine, c.reason) : c.reason,
      c.topics,
    ),
    createdAt: BigInt(Math.round(c.createdAt)) * BigInt(1_000_000),
    validated: c.validated,
    flagged: c.flagged,
    validatedAt: c.validatedAt ? [BigInt(Math.round(c.validatedAt)) * BigInt(1_000_000)] as [bigint] : [] as [],
  };
}

export function evalToContentItem(e: Awaited<ReturnType<_SERVICE["getUserEvaluations"]>>[number]): ContentItem {
  const { engine, cleanReason: reasonWithTopics } = decodeEngineFromReason(e.reason);
  const { topics, cleanReason } = decodeTopicsFromReason(reasonWithTopics);
  return {
    id: e.id,
    owner: e.owner.toText(),
    author: e.author,
    avatar: e.avatar,
    text: e.text,
    source: mapSourceBack(e.source) as ContentItem["source"],
    sourceUrl: e.sourceUrl.length > 0 ? e.sourceUrl[0] : undefined,
    imageUrl: e.imageUrl?.length ? e.imageUrl[0] : undefined,
    scores: {
      originality: e.scores.originality,
      insight: e.scores.insight,
      credibility: e.scores.credibility,
      composite: e.scores.compositeScore,
    },
    verdict: ("quality" in e.verdict ? "quality" : "slop") as ContentItem["verdict"],
    reason: cleanReason,
    topics: topics.length > 0 ? topics : undefined,
    createdAt: Number(e.createdAt) / 1_000_000,
    validated: e.validated,
    flagged: e.flagged,
    validatedAt: e.validatedAt.length > 0 ? Number(e.validatedAt[0]) / 1_000_000 : undefined,
    timestamp: relativeTime(Number(e.createdAt) / 1_000_000),
    scoredByAI: engine ? engine !== "heuristic" : !e.reason.startsWith("Heuristic"),
    scoringEngine: engine,
  };
}

export function mergePageIntoContent(
  pageItems: ContentItem[],
  prev: ContentItem[],
): ContentItem[] {
  const cachedById = new Map(prev.map(c => [c.id, c]));
  const merged = pageItems.map(l => {
    const cached = cachedById.get(l.id);
    if (!cached) return l;
    return {
      ...l,
      topics: l.topics ?? cached.topics,
      vSignal: l.vSignal ?? cached.vSignal,
      cContext: l.cContext ?? cached.cContext,
      lSlop: l.lSlop ?? cached.lSlop,
      imageUrl: l.imageUrl ?? cached.imageUrl,
      platform: l.platform ?? cached.platform,
    };
  });
  const loadedIds = new Set(pageItems.map(l => l.id));
  const nonDuplicates = prev.filter(c => !loadedIds.has(c.id));
  return [...merged, ...nonDuplicates];
}

/** IC call with offline queue fallback on failure. */
export function syncToIC(
  promise: Promise<unknown>,
  actionType: "saveEvaluation" | "updateEvaluation",
  payload: unknown,
  setSyncStatus: (s: "idle" | "syncing" | "synced" | "offline") => void,
  setPendingActions: React.Dispatch<React.SetStateAction<number>>,
  addNotification: (msg: string, type: "error" | "info" | "success") => void,
) {
  promise.then(undefined, async (err: unknown) => {
    console.warn("[content] IC sync failed:", errMsg(err));
    setSyncStatus("offline");
    try {
      await enqueueAction(actionType, payload);
      setPendingActions(p => p + 1);
      addNotification("Saved locally \u2014 will sync when online", "info");
    } catch (qErr) {
      console.error("[content] Failed to enqueue offline action:", errMsg(qErr));
      addNotification("Failed to save \u2014 changes may be lost", "error");
    }
  }).catch((unexpectedErr: unknown) => {
    // Safety net: catch any unexpected error in the rejection handler itself
    console.error("[content] Unexpected error in syncToIC handler:", errMsg(unexpectedErr));
  });
}

export async function drainOfflineQueue(
  actor: _SERVICE,
  principal: import("@dfinity/principal").Principal,
  contentRef: React.MutableRefObject<ContentItem[]>,
  setPendingActions: React.Dispatch<React.SetStateAction<number>>,
  setSyncStatus: (s: "idle" | "syncing" | "synced" | "offline") => void,
  addNotification?: (msg: string, type: "error" | "info" | "success") => void,
) {
  const actions = await dequeueAll();
  if (actions.length === 0) return;
  console.info(`[offline-queue] Draining ${actions.length} pending action(s)`);
  const MAX_RETRIES = 5;
  let droppedCount = 0;
  for (const action of actions) {
    const actionId = action.id;
    if (actionId == null) {
      console.error("[offline-queue] Action missing ID, skipping:", action.type);
      continue;
    }
    if (action.retries >= MAX_RETRIES) {
      console.warn(`[offline-queue] Dropping action ${actionId} after ${MAX_RETRIES} retries`);
      Sentry.captureMessage(`Offline action dropped after ${MAX_RETRIES} retries`, { level: "warning", extra: { actionId, type: action.type } });
      droppedCount++;
      await removeAction(actionId);
      continue;
    }
    try {
      if (action.type === "updateEvaluation") {
        const { id, validated, flagged } = action.payload as { id: string; validated: boolean; flagged: boolean };
        await actor.updateEvaluation(id, validated, flagged);
      } else if (action.type === "saveEvaluation") {
        const { itemId } = action.payload as { itemId: string };
        const item = contentRef.current.find(c => c.id === itemId);
        if (!item) {
          console.warn(`[offline-queue] Referenced item ${itemId} no longer in local content, dropping action ${actionId}`);
          await removeAction(actionId);
          continue;
        }
        await actor.saveEvaluation(toICEvaluation(item, principal));
      }
      await removeAction(actionId);
    } catch (err) {
      console.warn(`[offline-queue] Replay failed for action ${actionId}:`, errMsg(err));
      await incrementRetries(actionId);
    }
  }
  if (droppedCount > 0) {
    addNotification?.(`${droppedCount} offline change(s) could not be synced and were discarded`, "error");
  }
  const remaining = await dequeueAll();
  setPendingActions(remaining.length);
  if (remaining.length === 0) {
    setSyncStatus("synced");
    console.info("[offline-queue] All pending actions synced");
  }
}

export async function loadFromICCanister(
  actor: _SERVICE,
  principal: import("@dfinity/principal").Principal,
  setContent: React.Dispatch<React.SetStateAction<ContentItem[]>>,
  setSyncStatus: (s: "idle" | "syncing" | "synced" | "offline") => void,
  syncRetryRef: React.MutableRefObject<number>,
  syncRetryTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>,
  loadFromICRef: React.MutableRefObject<() => Promise<void>>,
  addNotification: (msg: string, type: "error" | "info" | "success") => void,
  backfillImageUrls: () => (() => void),
  backfillCleanupRef: React.MutableRefObject<(() => void) | null>,
) {
  setSyncStatus("syncing");

  const IC_PAGE_TIMEOUT = 15_000;

  await Sentry.startSpan({ name: "ic.loadEvaluations", op: "ic.sync" }, async () => {
  try {
    const PAGE_SIZE = BigInt(100);
    const MAX_PAGES = 50;
    let offset = BigInt(0);
    for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
      const page = await withTimeout(
        actor.getUserEvaluations(principal, offset, PAGE_SIZE),
        IC_PAGE_TIMEOUT,
        `IC pagination timeout (page ${pageNum})`,
      );

      const pageItems = page.map(evalToContentItem);
      if (pageItems.length > 0) {
        setContent(prev => mergePageIntoContent(pageItems, prev));
      }

      if (BigInt(page.length) < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (pageNum === MAX_PAGES - 1) {
        console.warn(`[content] Pagination limit reached (${MAX_PAGES} pages). Some evaluations may not be loaded.`);
      }
    }

    syncRetryRef.current = 0;
    setSyncStatus("synced");

    backfillCleanupRef.current?.();
    backfillCleanupRef.current = backfillImageUrls();
  } catch (err) {
    if (handleICSessionError(err)) {
      setSyncStatus("offline");
      return;
    }
    console.error("[content] Failed to load from IC:", errMsg(err));

    if (syncRetryRef.current < 1) {
      syncRetryRef.current++;
      console.info("[content] Retrying IC sync in 3s...");
      setSyncStatus("idle");
      clearTimeout(syncRetryTimerRef.current);
      syncRetryTimerRef.current = setTimeout(() => {
        loadFromICRef.current().catch((retryErr: unknown) => {
          console.error("[content] IC sync retry failed:", errMsg(retryErr));
          setSyncStatus("offline");
          addNotification("IC sync unavailable", "error");
        });
      }, 3000);
      return;
    }

    syncRetryRef.current = 0;
    setSyncStatus("offline");
    addNotification(`IC sync unavailable — ${errMsgShort(err)}`, "error");
  }
  });
}
