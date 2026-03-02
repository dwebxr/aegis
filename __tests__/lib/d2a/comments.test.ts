/**
 * @jest-environment jsdom
 */
import { loadComments, saveComment, getCommentsForContent, clearOldComments } from "@/lib/d2a/comments";
import type { StoredComment } from "@/lib/d2a/comments";

const STORAGE_KEY = "aegis-d2a-comments";

function makeComment(overrides: Partial<StoredComment> = {}): StoredComment {
  return {
    id: `hash-pk-${Date.now()}`,
    contentHash: "abcd1234",
    senderPk: "sender1234",
    comment: "Great article!",
    timestamp: Date.now(),
    direction: "received",
    ...overrides,
  };
}

describe("D2A Comments Storage", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("returns empty array when no comments stored", () => {
    expect(loadComments()).toEqual([]);
  });

  it("saves and loads a comment", () => {
    const c = makeComment();
    saveComment(c);
    const all = loadComments();
    expect(all).toHaveLength(1);
    expect(all[0].comment).toBe("Great article!");
  });

  it("saves multiple comments", () => {
    saveComment(makeComment({ id: "c1", timestamp: 1000 }));
    saveComment(makeComment({ id: "c2", timestamp: 2000 }));
    saveComment(makeComment({ id: "c3", timestamp: 3000 }));
    expect(loadComments()).toHaveLength(3);
  });

  it("filters comments by contentHash", () => {
    saveComment(makeComment({ id: "c1", contentHash: "hash-a" }));
    saveComment(makeComment({ id: "c2", contentHash: "hash-b" }));
    saveComment(makeComment({ id: "c3", contentHash: "hash-a" }));
    expect(getCommentsForContent("hash-a")).toHaveLength(2);
    expect(getCommentsForContent("hash-b")).toHaveLength(1);
    expect(getCommentsForContent("hash-c")).toHaveLength(0);
  });

  it("clears comments older than maxAgeDays", () => {
    const now = Date.now();
    const oldTs = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago
    saveComment(makeComment({ id: "old", timestamp: oldTs }));
    saveComment(makeComment({ id: "new", timestamp: now }));
    clearOldComments(30);
    const remaining = loadComments();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("new");
  });

  it("keeps comments within maxAgeDays", () => {
    const now = Date.now();
    const recentTs = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago
    saveComment(makeComment({ id: "recent", timestamp: recentTs }));
    clearOldComments(30);
    expect(loadComments()).toHaveLength(1);
  });

  it("enforces 500 comment limit", () => {
    for (let i = 0; i < 510; i++) {
      saveComment(makeComment({ id: `c${i}`, timestamp: i }));
    }
    const all = loadComments();
    expect(all.length).toBeLessThanOrEqual(500);
    // Should keep the newest ones
    expect(all[all.length - 1].timestamp).toBe(509);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    expect(loadComments()).toEqual([]);
  });

  it("handles non-array localStorage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, '{"foo": "bar"}');
    expect(loadComments()).toEqual([]);
  });

  it("saves both sent and received directions", () => {
    saveComment(makeComment({ id: "s1", direction: "sent" }));
    saveComment(makeComment({ id: "r1", direction: "received" }));
    const all = loadComments();
    expect(all.find(c => c.id === "s1")?.direction).toBe("sent");
    expect(all.find(c => c.id === "r1")?.direction).toBe("received");
  });

  it("preserves comment content accurately", () => {
    const c = makeComment({
      id: "test",
      comment: "Unicode: \u2713 \u2717 \u2B50",
      contentHash: "cafebabe",
      senderPk: "deadbeef1234567890",
    });
    saveComment(c);
    const loaded = loadComments();
    expect(loaded[0]).toEqual(c);
  });
});
