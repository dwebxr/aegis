import "fake-indexeddb/auto";
import {
  mapSource,
  toICEvaluation,
  evalToContentItem,
  mergePageIntoContent,
  syncToIC,
  drainOfflineQueue,
  loadFromICCanister,
} from "@/contexts/content/icSync";
import { clearQueue, enqueueAction, dequeueAll, incrementRetries } from "@/lib/offline/actionQueue";
import type { ContentItem } from "@/lib/types/content";
import { Principal } from "@dfinity/principal";

jest.mock("@sentry/nextjs", () => ({
  startSpan: jest.fn((_opts: unknown, fn: () => unknown) => fn()),
  setTag: jest.fn(),
  captureMessage: jest.fn(),
}));

beforeEach(async () => {
  await clearQueue();
});

const principal = Principal.fromText("rluf3-eiaaa-aaaam-qgjuq-cai");

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-id",
    owner: principal.toText(),
    author: "Test Author",
    avatar: "",
    text: "Test content text",
    source: "rss",
    scores: { originality: 7, insight: 6, credibility: 8, composite: 7 },
    verdict: "quality",
    reason: "Good content",
    createdAt: 1700000000000,
    validated: false,
    flagged: false,
    timestamp: "1m ago",
    ...overrides,
  };
}

describe("mapSource — edge cases", () => {
  it("maps 'farcaster' to 'manual' (not in SOURCE_KEYS)", () => {
    expect("manual" in mapSource("farcaster")).toBe(true);
  });

  it("maps arbitrary strings to 'manual'", () => {
    expect("manual" in mapSource("youtube")).toBe(true);
    expect("manual" in mapSource("")).toBe(true);
    expect("manual" in mapSource("123")).toBe(true);
  });
});

describe("toICEvaluation — edge cases", () => {
  it("handles negative scores by rounding", () => {
    const item = makeItem({
      scores: { originality: -1.5, insight: 0, credibility: 0.4, composite: -0.3 },
    });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.scores.originality).toBe(Math.round(-1.5)); // -1 in JS
    expect(eval_.scores.credibility).toBe(0);
  });

  it("handles missing scoringEngine (no engine prefix)", () => {
    const item = makeItem({ scoringEngine: undefined, reason: "Plain reason" });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.reason).toBe("Plain reason"); // No engine prefix
  });

  it("handles empty topics array", () => {
    const item = makeItem({ topics: [] });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.reason).not.toContain("[topics:");
  });

  it("handles missing validatedAt", () => {
    const item = makeItem({ validatedAt: undefined });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.validatedAt).toEqual([]);
  });

  it("timestamp conversion: createdAt to nanoseconds bigint", () => {
    const item = makeItem({ createdAt: 1700000000000 });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.createdAt).toBe(BigInt(1700000000000) * BigInt(1_000_000));
  });
});

describe("evalToContentItem — edge cases", () => {
  it("handles legacy reason without engine prefix", () => {
    const icEval = {
      id: "legacy",
      owner: principal,
      author: "A",
      avatar: "",
      text: "T",
      source: { rss: null },
      sourceUrl: [] as [],
      imageUrl: [] as [],
      scores: { originality: 5, insight: 5, credibility: 5, compositeScore: 5 },
      verdict: { quality: null },
      reason: "Just a regular reason",
      createdAt: BigInt(1000000000),
      validated: false,
      flagged: false,
      validatedAt: [] as [],
    };
    const item = evalToContentItem(icEval);
    expect(item.scoringEngine).toBeUndefined();
    // No engine prefix + doesn't start with "Heuristic" → scoredByAI = true (assumed AI-scored legacy item)
    expect(item.scoredByAI).toBe(true);
    expect(item.reason).toBe("Just a regular reason");
  });

  it("handles reason starting with 'Heuristic' (legacy marker)", () => {
    const icEval = {
      id: "heur",
      owner: principal,
      author: "A",
      avatar: "",
      text: "T",
      source: { manual: null },
      sourceUrl: [] as [],
      imageUrl: [] as [],
      scores: { originality: 3, insight: 2, credibility: 4, compositeScore: 3 },
      verdict: { slop: null },
      reason: "Heuristic scoring: low quality",
      createdAt: BigInt(1000000000),
      validated: false,
      flagged: false,
      validatedAt: [] as [],
    };
    const item = evalToContentItem(icEval);
    expect(item.scoringEngine).toBe("heuristic");
    expect(item.scoredByAI).toBe(false);
  });

  it("decodes topics from reason field", () => {
    const icEval = {
      id: "topics",
      owner: principal,
      author: "A",
      avatar: "",
      text: "T",
      source: { rss: null },
      sourceUrl: [] as [],
      imageUrl: [] as [],
      scores: { originality: 7, insight: 7, credibility: 7, compositeScore: 7 },
      verdict: { quality: null },
      reason: "[claude-server] Good analysis [topics:ai,blockchain,security]",
      createdAt: BigInt(1700000000000000000n),
      validated: true,
      flagged: false,
      validatedAt: [] as [],
    };
    const item = evalToContentItem(icEval);
    expect(item.scoringEngine).toBe("claude-server");
    expect(item.topics).toEqual(["ai", "blockchain", "security"]);
    expect(item.reason).toBe("Good analysis");
  });

  it("handles unknown source type by mapping to 'manual'", () => {
    const icEval = {
      id: "unk",
      owner: principal,
      author: "A",
      avatar: "",
      text: "T",
      source: { weird_source: null } as unknown,
      sourceUrl: [] as [],
      imageUrl: [] as [],
      scores: { originality: 5, insight: 5, credibility: 5, compositeScore: 5 },
      verdict: { quality: null },
      reason: "test",
      createdAt: BigInt(1000000000),
      validated: false,
      flagged: false,
      validatedAt: [] as [],
    };
    const item = evalToContentItem(icEval as Parameters<typeof evalToContentItem>[0]);
    expect(item.source).toBe("manual");
  });
});

describe("mergePageIntoContent — edge cases", () => {
  it("preserves local platform when IC has none", () => {
    const existing = [makeItem({ id: "s1", platform: "youtube" as ContentItem["platform"] })];
    const page = [makeItem({ id: "s1", platform: undefined })];
    const result = mergePageIntoContent(page, existing);
    expect(result[0].platform).toBe("youtube");
  });

  it("prefers IC platform when both have it", () => {
    const existing = [makeItem({ id: "s1", platform: "youtube" as ContentItem["platform"] })];
    const page = [makeItem({ id: "s1", platform: "bluesky" as ContentItem["platform"] })];
    const result = mergePageIntoContent(page, existing);
    expect(result[0].platform).toBe("bluesky");
  });

  it("handles multiple pages merging correctly", () => {
    const existing = [makeItem({ id: "e1" }), makeItem({ id: "e2" })];
    const page1 = [makeItem({ id: "p1" }), makeItem({ id: "e1", text: "updated" })];
    const merged1 = mergePageIntoContent(page1, existing);
    expect(merged1).toHaveLength(3);
    expect(merged1.find(c => c.id === "e1")!.text).toBe("updated");

    // Second page
    const page2 = [makeItem({ id: "p2" })];
    const merged2 = mergePageIntoContent(page2, merged1);
    expect(merged2).toHaveLength(4);
  });

  it("preserves local cContext and lSlop when IC has none", () => {
    const existing = [makeItem({ id: "x", cContext: 3, lSlop: 7 })];
    const page = [makeItem({ id: "x", cContext: undefined, lSlop: undefined })];
    const result = mergePageIntoContent(page, existing);
    expect(result[0].cContext).toBe(3);
    expect(result[0].lSlop).toBe(7);
  });
});

describe("syncToIC — enqueue failure", () => {
  it("notifies with error message when enqueue fails", async () => {
    // Mock enqueueAction to throw
    jest.resetModules();
    jest.mock("@/lib/offline/actionQueue", () => ({
      ...jest.requireActual("@/lib/offline/actionQueue"),
      enqueueAction: jest.fn().mockRejectedValue(new Error("IDB full")),
    }));
    const { syncToIC: syncToICFresh } = await import("@/contexts/content/icSync");

    const setSyncStatus = jest.fn();
    const setPendingActions = jest.fn();
    const addNotification = jest.fn();

    syncToICFresh(Promise.reject(new Error("IC down")), "saveEvaluation", {}, setSyncStatus, setPendingActions, addNotification);

    await new Promise(r => setTimeout(r, 100));

    expect(setSyncStatus).toHaveBeenCalledWith("offline");
    expect(addNotification).toHaveBeenCalledWith(expect.stringContaining("lost"), "error");
  });
});

describe("drainOfflineQueue — mixed actions", () => {
  function makeMockActor(overrides: Record<string, jest.Mock> = {}) {
    return {
      updateEvaluation: jest.fn().mockResolvedValue(undefined),
      saveEvaluation: jest.fn().mockResolvedValue(undefined),
      getUserEvaluations: jest.fn(),
      analyzeOnChain: jest.fn(),
      ...overrides,
    } as unknown as import("@/lib/ic/declarations")._SERVICE;
  }

  it("processes multiple actions in order", async () => {
    await enqueueAction("updateEvaluation", { id: "a1", validated: true, flagged: false });
    await enqueueAction("saveEvaluation", { itemId: "a2" });
    await enqueueAction("updateEvaluation", { id: "a3", validated: false, flagged: true });

    const actor = makeMockActor();
    const contentRef = { current: [makeItem({ id: "a2" })] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    expect(actor.updateEvaluation).toHaveBeenCalledTimes(2);
    expect(actor.saveEvaluation).toHaveBeenCalledTimes(1);
    expect(setSyncStatus).toHaveBeenCalledWith("synced");
    expect(setPendingActions).toHaveBeenCalledWith(0);
  });

  it("partial failure leaves remaining in queue", async () => {
    await enqueueAction("updateEvaluation", { id: "ok1", validated: true, flagged: false });
    await enqueueAction("updateEvaluation", { id: "fail1", validated: false, flagged: true });

    const actor = makeMockActor({
      updateEvaluation: jest.fn()
        .mockResolvedValueOnce(undefined) // ok1 succeeds
        .mockRejectedValueOnce(new Error("IC error")), // fail1 fails
    });
    const contentRef = { current: [] as ContentItem[] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    const remaining = await dequeueAll();
    expect(remaining).toHaveLength(1);
    expect((remaining[0].payload as { id: string }).id).toBe("fail1");
    expect(remaining[0].retries).toBe(1);
  });

  it("drops actions that reach MAX_RETRIES and still processes others", async () => {
    await enqueueAction("updateEvaluation", { id: "drop-me", validated: true, flagged: false });
    const actions = await dequeueAll();
    for (let i = 0; i < 5; i++) await incrementRetries(actions[0].id!);

    await enqueueAction("updateEvaluation", { id: "keep-me", validated: true, flagged: false });

    const actor = makeMockActor();
    const contentRef = { current: [] as ContentItem[] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    // drop-me should be removed, keep-me should succeed
    expect(actor.updateEvaluation).toHaveBeenCalledTimes(1);
    expect(actor.updateEvaluation).toHaveBeenCalledWith("keep-me", true, false);
    expect(setPendingActions).toHaveBeenCalledWith(0);
  });
});

describe("loadFromICCanister — pagination", () => {
  function makeMockActor(pages: Parameters<typeof evalToContentItem>[0][][]) {
    let callIdx = 0;
    return {
      getUserEvaluations: jest.fn(async () => {
        return pages[callIdx++] ?? [];
      }),
    } as unknown as import("@/lib/ic/declarations")._SERVICE;
  }

  function makeICEval(id: string) {
    return {
      id,
      owner: principal,
      author: "A",
      avatar: "",
      text: "T",
      source: { rss: null },
      sourceUrl: [] as [],
      imageUrl: [] as [],
      scores: { originality: 5, insight: 5, credibility: 5, compositeScore: 5 },
      verdict: { quality: null },
      reason: "test",
      createdAt: BigInt(1700000000000) * BigInt(1_000_000),
      validated: false,
      flagged: false,
      validatedAt: [] as [],
    };
  }

  it("loads single page of results", async () => {
    const actor = makeMockActor([[makeICEval("p1"), makeICEval("p2")]]);
    const setContent = jest.fn();
    const setSyncStatus = jest.fn();
    const syncRetryRef = { current: 0 };
    const syncRetryTimerRef = { current: undefined as ReturnType<typeof setTimeout> | undefined };
    const loadFromICRef = { current: async () => {} };
    const addNotification = jest.fn();
    const backfillImageUrls = jest.fn(() => () => {});
    const backfillCleanupRef = { current: null as (() => void) | null };

    await loadFromICCanister(
      actor, principal, setContent, setSyncStatus,
      syncRetryRef, syncRetryTimerRef, loadFromICRef, addNotification,
      backfillImageUrls, backfillCleanupRef,
    );

    expect(setSyncStatus).toHaveBeenCalledWith("syncing");
    expect(setSyncStatus).toHaveBeenCalledWith("synced");
    expect(setContent).toHaveBeenCalled();
    expect(backfillImageUrls).toHaveBeenCalled();
  });

  it("paginates through multiple pages", async () => {
    // First page has 100 items (full page), second has 50 (partial = last page)
    const page1 = Array.from({ length: 100 }, (_, i) => makeICEval(`page1-${i}`));
    const page2 = Array.from({ length: 50 }, (_, i) => makeICEval(`page2-${i}`));
    const actor = makeMockActor([page1, page2]);
    const setContent = jest.fn();
    const setSyncStatus = jest.fn();

    await loadFromICCanister(
      actor, principal, setContent, setSyncStatus,
      { current: 0 }, { current: undefined },
      { current: async () => {} }, jest.fn(),
      jest.fn(() => () => {}), { current: null },
    );

    expect(actor.getUserEvaluations).toHaveBeenCalledTimes(2);
    expect(setContent).toHaveBeenCalledTimes(2); // Once per page
    expect(setSyncStatus).toHaveBeenCalledWith("synced");
  });

  it("handles empty canister (no evaluations)", async () => {
    const actor = makeMockActor([[]]);
    const setContent = jest.fn();
    const setSyncStatus = jest.fn();

    await loadFromICCanister(
      actor, principal, setContent, setSyncStatus,
      { current: 0 }, { current: undefined },
      { current: async () => {} }, jest.fn(),
      jest.fn(() => () => {}), { current: null },
    );

    expect(setContent).not.toHaveBeenCalled(); // No items to merge
    expect(setSyncStatus).toHaveBeenCalledWith("synced");
  });

  it("retries once on first failure", async () => {
    const actor = {
      getUserEvaluations: jest.fn().mockRejectedValue(new Error("Network error")),
    } as unknown as import("@/lib/ic/declarations")._SERVICE;

    const setSyncStatus = jest.fn();
    const syncRetryRef = { current: 0 };
    const loadFromICRef = { current: jest.fn(async () => {}) };
    const syncRetryTimerRef = { current: undefined as ReturnType<typeof setTimeout> | undefined };

    await loadFromICCanister(
      actor, principal, jest.fn(), setSyncStatus,
      syncRetryRef, syncRetryTimerRef,
      loadFromICRef, jest.fn(),
      jest.fn(() => () => {}), { current: null },
    );

    expect(syncRetryRef.current).toBe(1);
    expect(setSyncStatus).toHaveBeenCalledWith("idle"); // Retry pending
  });

  it("gives up after second failure", async () => {
    const actor = {
      getUserEvaluations: jest.fn().mockRejectedValue(new Error("Network error")),
    } as unknown as import("@/lib/ic/declarations")._SERVICE;

    const setSyncStatus = jest.fn();
    const syncRetryRef = { current: 1 }; // Already retried once
    const addNotification = jest.fn();

    await loadFromICCanister(
      actor, principal, jest.fn(), setSyncStatus,
      syncRetryRef, { current: undefined },
      { current: async () => {} }, addNotification,
      jest.fn(() => () => {}), { current: null },
    );

    expect(syncRetryRef.current).toBe(0); // Reset
    expect(setSyncStatus).toHaveBeenCalledWith("offline");
    expect(addNotification).toHaveBeenCalledWith(expect.stringContaining("unavailable"), "error");
  });
});
