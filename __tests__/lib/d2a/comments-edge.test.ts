// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  },
  writable: true,
  configurable: true,
});

import { loadComments, saveComment, getCommentsForContent, clearOldComments, type StoredComment } from "@/lib/d2a/comments";

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

function makeComment(overrides: Partial<StoredComment> = {}): StoredComment {
  return {
    id: `comment-${Math.random().toString(36).slice(2)}`,
    contentHash: "hash1",
    senderPk: "pk1",
    comment: "test comment",
    timestamp: Date.now(),
    direction: "received",
    ...overrides,
  };
}

describe("saveComment — MAX_COMMENTS (500) enforcement", () => {
  it("drops oldest comments when exceeding 500", () => {
    // Seed 500 comments
    const comments: StoredComment[] = Array.from({ length: 500 }, (_, i) =>
      makeComment({ id: `c${i}`, timestamp: 1000 + i }),
    );
    store["aegis-d2a-comments"] = JSON.stringify(comments);

    // Add one more
    saveComment(makeComment({ id: "new-one", timestamp: 2000 }));

    const loaded = loadComments();
    expect(loaded).toHaveLength(500);
    // Oldest (timestamp 1000) should be gone
    expect(loaded.find(c => c.id === "c0")).toBeUndefined();
    // Newest should be present
    expect(loaded.find(c => c.id === "new-one")).toBeDefined();
  });

  it("allows up to 500 comments without dropping", () => {
    const comments: StoredComment[] = Array.from({ length: 499 }, (_, i) =>
      makeComment({ id: `c${i}`, timestamp: 1000 + i }),
    );
    store["aegis-d2a-comments"] = JSON.stringify(comments);

    saveComment(makeComment({ id: "500th", timestamp: 2000 }));

    const loaded = loadComments();
    expect(loaded).toHaveLength(500);
  });
});

describe("getCommentsForContent", () => {
  it("filters by contentHash", () => {
    saveComment(makeComment({ contentHash: "hash-a", comment: "A" }));
    saveComment(makeComment({ contentHash: "hash-b", comment: "B" }));
    saveComment(makeComment({ contentHash: "hash-a", comment: "C" }));

    const result = getCommentsForContent("hash-a");
    expect(result).toHaveLength(2);
    expect(result.every(c => c.contentHash === "hash-a")).toBe(true);
  });

  it("returns empty for non-existent hash", () => {
    saveComment(makeComment({ contentHash: "exists" }));
    expect(getCommentsForContent("nope")).toEqual([]);
  });

  it("returns empty when no comments stored", () => {
    expect(getCommentsForContent("anything")).toEqual([]);
  });
});

describe("clearOldComments", () => {
  it("removes comments older than 30 days by default", () => {
    const now = Date.now();
    const oldTimestamp = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago
    const recentTimestamp = now - 1 * 24 * 60 * 60 * 1000; // 1 day ago

    saveComment(makeComment({ id: "old", timestamp: oldTimestamp }));
    saveComment(makeComment({ id: "recent", timestamp: recentTimestamp }));

    clearOldComments();

    const loaded = loadComments();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("recent");
  });

  it("respects custom maxAgeDays", () => {
    const now = Date.now();
    saveComment(makeComment({ id: "c1", timestamp: now - 8 * 24 * 60 * 60 * 1000 })); // 8 days ago
    saveComment(makeComment({ id: "c2", timestamp: now - 3 * 24 * 60 * 60 * 1000 })); // 3 days ago

    clearOldComments(7); // Keep only last 7 days

    const loaded = loadComments();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("c2");
  });

  it("keeps all comments when none are old", () => {
    const now = Date.now();
    saveComment(makeComment({ id: "c1", timestamp: now }));
    saveComment(makeComment({ id: "c2", timestamp: now - 1000 }));

    clearOldComments();

    expect(loadComments()).toHaveLength(2);
  });

  it("clears all when all are old", () => {
    const oldTimestamp = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago
    saveComment(makeComment({ id: "c1", timestamp: oldTimestamp }));
    saveComment(makeComment({ id: "c2", timestamp: oldTimestamp + 1000 }));

    clearOldComments();

    expect(loadComments()).toHaveLength(0);
  });
});

describe("loadComments — error handling", () => {
  it("returns empty for corrupted JSON", () => {
    store["aegis-d2a-comments"] = "{{broken";
    expect(loadComments()).toEqual([]);
  });

  it("returns empty for non-array JSON", () => {
    store["aegis-d2a-comments"] = JSON.stringify({ not: "array" });
    expect(loadComments()).toEqual([]);
  });

  it("handles empty string in storage", () => {
    store["aegis-d2a-comments"] = "";
    expect(loadComments()).toEqual([]);
  });
});

describe("saveComment — direction field", () => {
  it("stores 'sent' direction correctly", () => {
    saveComment(makeComment({ id: "sent-1", direction: "sent" }));
    const loaded = loadComments();
    expect(loaded.find(c => c.id === "sent-1")?.direction).toBe("sent");
  });

  it("stores 'received' direction correctly", () => {
    saveComment(makeComment({ id: "recv-1", direction: "received" }));
    const loaded = loadComments();
    expect(loaded.find(c => c.id === "recv-1")?.direction).toBe("received");
  });
});
