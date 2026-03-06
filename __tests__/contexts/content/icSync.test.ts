import "fake-indexeddb/auto";
import {
  mapSource,
  toICEvaluation,
  evalToContentItem,
  mergePageIntoContent,
  syncToIC,
  drainOfflineQueue,
} from "@/contexts/content/icSync";
import { clearQueue, enqueueAction, dequeueAll } from "@/lib/offline/actionQueue";
import type { ContentItem } from "@/lib/types/content";
import { Principal } from "@dfinity/principal";

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

describe("mapSource", () => {
  it.each(["rss", "url", "twitter", "nostr", "manual"] as const)("maps '%s' to IC ContentSource", (key) => {
    const result = mapSource(key);
    expect(key in result).toBe(true);
  });

  it("maps unknown source to 'manual'", () => {
    const result = mapSource("farcaster");
    expect("manual" in result).toBe(true);
  });

  it("maps empty string to 'manual'", () => {
    expect("manual" in mapSource("")).toBe(true);
  });
});

describe("toICEvaluation", () => {
  it("converts ContentItem to IC evaluation record", () => {
    const item = makeItem({
      sourceUrl: "https://example.com/article",
      imageUrl: "https://example.com/img.jpg",
      scoringEngine: "claude-server",
      topics: ["ai", "research"],
    });
    const eval_ = toICEvaluation(item, principal);

    expect(eval_.id).toBe("test-id");
    expect(eval_.owner).toBe(principal);
    expect(eval_.author).toBe("Test Author");
    expect(eval_.text).toBe("Test content text");
    expect(eval_.sourceUrl).toEqual(["https://example.com/article"]);
    expect(eval_.imageUrl).toEqual(["https://example.com/img.jpg"]);
    expect(eval_.scores.compositeScore).toBe(7);
    expect(eval_.scores.originality).toBe(7);
    expect(eval_.validated).toBe(false);
    expect(eval_.flagged).toBe(false);
    expect(typeof eval_.createdAt).toBe("bigint");
  });

  it("uses empty optional arrays when sourceUrl/imageUrl absent", () => {
    const item = makeItem({ sourceUrl: undefined, imageUrl: undefined });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.sourceUrl).toEqual([]);
    expect(eval_.imageUrl).toEqual([]);
  });

  it("encodes scoring engine in reason field", () => {
    const item = makeItem({ scoringEngine: "ollama", reason: "Good" });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.reason).toContain("ollama");
  });

  it("encodes topics in reason field", () => {
    const item = makeItem({ topics: ["tech", "science"] });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.reason).toContain("tech");
    expect(eval_.reason).toContain("science");
  });

  it("handles validatedAt timestamp", () => {
    const item = makeItem({ validatedAt: 1700000001000 });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.validatedAt).toHaveLength(1);
    expect(typeof eval_.validatedAt[0]).toBe("bigint");
  });

  it("rounds scores to integers", () => {
    const item = makeItem({ scores: { originality: 7.6, insight: 5.3, credibility: 8.9, composite: 7.2 } });
    const eval_ = toICEvaluation(item, principal);
    expect(eval_.scores.originality).toBe(8);
    expect(eval_.scores.insight).toBe(5);
    expect(eval_.scores.credibility).toBe(9);
  });

  it("maps verdict to IC variant", () => {
    expect(toICEvaluation(makeItem({ verdict: "quality" }), principal).verdict).toEqual({ quality: null });
    expect(toICEvaluation(makeItem({ verdict: "slop" }), principal).verdict).toEqual({ slop: null });
  });
});

describe("evalToContentItem", () => {
  it("converts IC evaluation back to ContentItem", () => {
    const icEval = {
      id: "ic-1",
      owner: principal,
      author: "IC Author",
      avatar: "https://example.com/avatar.jpg",
      text: "IC text content",
      source: { rss: null },
      sourceUrl: ["https://example.com"] as [string],
      imageUrl: ["https://example.com/img.png"] as [string],
      scores: { originality: 8, insight: 7, credibility: 9, compositeScore: 8 },
      verdict: { quality: null },
      reason: "Good analysis",
      createdAt: BigInt(1700000000000) * BigInt(1_000_000),
      validated: true,
      flagged: false,
      validatedAt: [BigInt(1700000001000) * BigInt(1_000_000)] as [bigint],
    };

    const item = evalToContentItem(icEval);
    expect(item.id).toBe("ic-1");
    expect(item.source).toBe("rss");
    expect(item.verdict).toBe("quality");
    expect(item.sourceUrl).toBe("https://example.com");
    expect(item.imageUrl).toBe("https://example.com/img.png");
    expect(item.scores.composite).toBe(8);
    expect(item.validated).toBe(true);
    expect(item.validatedAt).toBe(1700000001000);
    expect(item.createdAt).toBe(1700000000000);
    expect(typeof item.timestamp).toBe("string");
  });

  it("handles slop verdict", () => {
    const icEval = {
      id: "ic-2",
      owner: principal,
      author: "A",
      avatar: "",
      text: "T",
      source: { manual: null },
      sourceUrl: [] as [],
      imageUrl: [] as [],
      scores: { originality: 2, insight: 1, credibility: 3, compositeScore: 2 },
      verdict: { slop: null },
      reason: "Low quality",
      createdAt: BigInt(1000000000),
      validated: false,
      flagged: true,
      validatedAt: [] as [],
    };
    const item = evalToContentItem(icEval);
    expect(item.verdict).toBe("slop");
    expect(item.sourceUrl).toBeUndefined();
    expect(item.imageUrl).toBeUndefined();
    expect(item.validatedAt).toBeUndefined();
    expect(item.source).toBe("manual");
    expect(item.flagged).toBe(true);
  });

  it("decodes engine from reason field", () => {
    const icEval = {
      id: "ic-3",
      owner: principal,
      author: "A",
      avatar: "",
      text: "T",
      source: { rss: null },
      sourceUrl: [] as [],
      imageUrl: [] as [],
      scores: { originality: 5, insight: 5, credibility: 5, compositeScore: 5 },
      verdict: { quality: null },
      reason: "[claude-server] Good content",
      createdAt: BigInt(1000000000),
      validated: false,
      flagged: false,
      validatedAt: [] as [],
    };
    const item = evalToContentItem(icEval);
    expect(item.scoringEngine).toBe("claude-server");
    expect(item.reason).not.toContain("[engine:");
    expect(item.scoredByAI).toBe(true);
  });

  it("recognizes heuristic engine as non-AI", () => {
    const icEval = {
      id: "ic-4",
      owner: principal,
      author: "A",
      avatar: "",
      text: "T",
      source: { rss: null },
      sourceUrl: [] as [],
      imageUrl: [] as [],
      scores: { originality: 5, insight: 5, credibility: 5, compositeScore: 5 },
      verdict: { quality: null },
      reason: "[heuristic] Heuristic scores",
      createdAt: BigInt(1000000000),
      validated: false,
      flagged: false,
      validatedAt: [] as [],
    };
    const item = evalToContentItem(icEval);
    expect(item.scoringEngine).toBe("heuristic");
    expect(item.scoredByAI).toBe(false);
  });
});

describe("mergePageIntoContent", () => {
  it("adds new items from page", () => {
    const existing = [makeItem({ id: "e1" })];
    const page = [makeItem({ id: "p1" }), makeItem({ id: "p2" })];
    const result = mergePageIntoContent(page, existing);
    expect(result).toHaveLength(3);
  });

  it("overwrites existing items with IC data, preserving local fields", () => {
    const existing = [makeItem({ id: "shared", topics: ["local-topic"], vSignal: 8, imageUrl: "local.png" })];
    const page = [makeItem({ id: "shared", topics: undefined, vSignal: undefined, imageUrl: undefined })];
    const result = mergePageIntoContent(page, existing);
    expect(result).toHaveLength(1);
    expect(result[0].topics).toEqual(["local-topic"]);
    expect(result[0].vSignal).toBe(8);
    expect(result[0].imageUrl).toBe("local.png");
  });

  it("prefers IC data when both have values", () => {
    const existing = [makeItem({ id: "shared", topics: ["old"] })];
    const page = [makeItem({ id: "shared", topics: ["new"] })];
    const result = mergePageIntoContent(page, existing);
    expect(result[0].topics).toEqual(["new"]);
  });

  it("handles empty page", () => {
    const existing = [makeItem({ id: "e1" })];
    const result = mergePageIntoContent([], existing);
    expect(result).toEqual(existing);
  });

  it("handles empty existing", () => {
    const page = [makeItem({ id: "p1" })];
    const result = mergePageIntoContent(page, []);
    expect(result).toHaveLength(1);
  });
});

describe("syncToIC", () => {
  it("enqueues action on promise failure", async () => {
    const setSyncStatus = jest.fn();
    const setPendingActions = jest.fn();
    const addNotification = jest.fn();

    const failingPromise = Promise.reject(new Error("Network error"));

    syncToIC(failingPromise, "saveEvaluation", { itemId: "x" }, setSyncStatus, setPendingActions, addNotification);

    // Wait for async catch handler
    await new Promise(r => setTimeout(r, 50));

    expect(setSyncStatus).toHaveBeenCalledWith("offline");
    expect(setPendingActions).toHaveBeenCalled();
    expect(addNotification).toHaveBeenCalledWith(expect.stringContaining("locally"), "info");

    const queued = await dequeueAll();
    expect(queued).toHaveLength(1);
    expect(queued[0].type).toBe("saveEvaluation");
  });

  it("does not enqueue on promise success", async () => {
    const setSyncStatus = jest.fn();
    const setPendingActions = jest.fn();
    const addNotification = jest.fn();

    syncToIC(Promise.resolve(), "saveEvaluation", {}, setSyncStatus, setPendingActions, addNotification);

    await new Promise(r => setTimeout(r, 50));

    expect(setSyncStatus).not.toHaveBeenCalled();
    const queued = await dequeueAll();
    expect(queued).toHaveLength(0);
  });
});

describe("drainOfflineQueue", () => {
  function makeMockActor() {
    return {
      updateEvaluation: jest.fn().mockResolvedValue(undefined),
      saveEvaluation: jest.fn().mockResolvedValue(undefined),
      getUserEvaluations: jest.fn(),
      analyzeOnChain: jest.fn(),
    } as unknown as import("@/lib/ic/declarations")._SERVICE;
  }

  it("replays updateEvaluation actions", async () => {
    await enqueueAction("updateEvaluation", { id: "item1", validated: true, flagged: false });

    const actor = makeMockActor();
    const contentRef = { current: [] as ContentItem[] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    expect(actor.updateEvaluation).toHaveBeenCalledWith("item1", true, false);
    expect(setSyncStatus).toHaveBeenCalledWith("synced");
    expect(setPendingActions).toHaveBeenCalledWith(0);
  });

  it("replays saveEvaluation actions with matching content item", async () => {
    await enqueueAction("saveEvaluation", { itemId: "save-me" });

    const actor = makeMockActor();
    const item = makeItem({ id: "save-me" });
    const contentRef = { current: [item] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    expect(actor.saveEvaluation).toHaveBeenCalled();
  });

  it("skips saveEvaluation when content item not found", async () => {
    await enqueueAction("saveEvaluation", { itemId: "missing" });

    const actor = makeMockActor();
    const contentRef = { current: [] as ContentItem[] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    expect(actor.saveEvaluation).not.toHaveBeenCalled();
  });

  it("drops actions after 5 retries", async () => {
    await enqueueAction("updateEvaluation", { id: "retry-me" });

    // Manually increment retries to 5
    const { incrementRetries } = await import("@/lib/offline/actionQueue");
    const actions = await dequeueAll();
    for (let i = 0; i < 5; i++) {
      await incrementRetries(actions[0].id!);
    }

    const actor = makeMockActor();
    const contentRef = { current: [] as ContentItem[] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    // Should not call actor methods for dropped action
    expect(actor.updateEvaluation).not.toHaveBeenCalled();
    // Queue should be empty after dropping
    const remaining = await dequeueAll();
    expect(remaining).toHaveLength(0);
  });

  it("increments retries on replay failure", async () => {
    await enqueueAction("updateEvaluation", { id: "fail-me", validated: true, flagged: false });

    const actor = makeMockActor();
    (actor.updateEvaluation as unknown as jest.Mock).mockRejectedValue(new Error("IC error"));
    const contentRef = { current: [] as ContentItem[] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    const remaining = await dequeueAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].retries).toBe(1);
  });

  it("does nothing when queue is empty", async () => {
    const actor = makeMockActor();
    const contentRef = { current: [] as ContentItem[] };
    const setPendingActions = jest.fn();
    const setSyncStatus = jest.fn();

    await drainOfflineQueue(actor, principal, contentRef, setPendingActions, setSyncStatus);

    expect(actor.updateEvaluation).not.toHaveBeenCalled();
    expect(setPendingActions).not.toHaveBeenCalled();
  });
});
