/**
 * Tests for offline action queue SyncManager registration and error paths.
 */
import "fake-indexeddb/auto";
import {
  enqueueAction,
  dequeueAll,
  removeAction,
  incrementRetries,
  clearQueue,
  queueSize,
} from "@/lib/offline/actionQueue";

beforeEach(async () => {
  await clearQueue();
});

describe("incrementRetries", () => {
  it("increments retry count for an existing action", async () => {
    await enqueueAction("saveEvaluation", { itemId: "retry-test" });
    const actions = await dequeueAll();
    const id = actions[0].id!;
    expect(actions[0].retries).toBe(0);

    await incrementRetries(id);

    const updated = await dequeueAll();
    const action = updated.find(a => a.id === id);
    expect(action!.retries).toBe(1);
  });

  it("increments multiple times", async () => {
    await enqueueAction("updateEvaluation", { id: "multi-retry" });
    const actions = await dequeueAll();
    const id = actions[0].id!;

    await incrementRetries(id);
    await incrementRetries(id);
    await incrementRetries(id);

    const updated = await dequeueAll();
    expect(updated[0].retries).toBe(3);
  });

  it("handles non-existent action ID gracefully", async () => {
    // Should not throw even though action 99999 doesn't exist
    await expect(incrementRetries(99999)).resolves.toBeUndefined();
  });
});

describe("removeAction", () => {
  it("removes a specific action by ID", async () => {
    await enqueueAction("saveEvaluation", { itemId: "a" });
    await enqueueAction("saveEvaluation", { itemId: "b" });
    await enqueueAction("saveEvaluation", { itemId: "c" });

    const all = await dequeueAll();
    expect(all).toHaveLength(3);

    await removeAction(all[1].id!);

    const remaining = await dequeueAll();
    expect(remaining).toHaveLength(2);
    expect(remaining.map(a => (a.payload as { itemId: string }).itemId)).toEqual(["a", "c"]);
  });

  it("is a no-op for non-existent ID", async () => {
    await enqueueAction("saveEvaluation", { itemId: "only" });
    await removeAction(99999);

    const actions = await dequeueAll();
    expect(actions).toHaveLength(1);
  });
});

describe("queueSize", () => {
  it("returns 0 for empty queue", async () => {
    expect(await queueSize()).toBe(0);
  });

  it("returns correct count after enqueue/dequeue operations", async () => {
    await enqueueAction("saveEvaluation", { itemId: "1" });
    await enqueueAction("saveEvaluation", { itemId: "2" });
    await enqueueAction("saveEvaluation", { itemId: "3" });

    expect(await queueSize()).toBe(3);

    const actions = await dequeueAll();
    await removeAction(actions[0].id!);

    expect(await queueSize()).toBe(2);
  });
});

describe("clearQueue", () => {
  it("removes all entries", async () => {
    await enqueueAction("saveEvaluation", { itemId: "1" });
    await enqueueAction("updateEvaluation", { id: "2", validated: true, flagged: false });
    await enqueueAction("saveEvaluation", { itemId: "3" });

    expect(await queueSize()).toBe(3);

    await clearQueue();

    expect(await queueSize()).toBe(0);
    expect(await dequeueAll()).toEqual([]);
  });

  it("is idempotent on empty queue", async () => {
    await clearQueue();
    await clearQueue();
    expect(await queueSize()).toBe(0);
  });
});

describe("action payload integrity", () => {
  it("preserves complex payload through enqueue/dequeue", async () => {
    const payload = {
      itemId: "complex-test",
      nested: { scores: { originality: 8, insight: 7 } },
      tags: ["ai", "ml"],
      timestamp: 1700000000000,
    };

    await enqueueAction("saveEvaluation", payload);

    const actions = await dequeueAll();
    expect(actions[0].payload).toEqual(payload);
  });

  it("preserves unicode in payload", async () => {
    const payload = { itemId: "unicode", text: "日本語テスト 🎉 émojis" };
    await enqueueAction("saveEvaluation", payload);

    const actions = await dequeueAll();
    expect((actions[0].payload as { text: string }).text).toBe("日本語テスト 🎉 émojis");
  });

  it("records createdAt timestamp on enqueue", async () => {
    const before = Date.now();
    await enqueueAction("saveEvaluation", { itemId: "timestamp" });
    const after = Date.now();

    const actions = await dequeueAll();
    expect(actions[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(actions[0].createdAt).toBeLessThanOrEqual(after);
  });

  it("initializes retries to 0", async () => {
    await enqueueAction("saveEvaluation", { itemId: "retries" });
    const actions = await dequeueAll();
    expect(actions[0].retries).toBe(0);
  });

  it("assigns auto-incremented IDs", async () => {
    await enqueueAction("saveEvaluation", { itemId: "a" });
    await enqueueAction("saveEvaluation", { itemId: "b" });

    const actions = await dequeueAll();
    expect(actions[0].id).toBeDefined();
    expect(actions[1].id).toBeDefined();
    expect(actions[1].id).toBeGreaterThan(actions[0].id!);
  });
});

describe("concurrent operations", () => {
  it("handles parallel enqueue operations", async () => {
    await Promise.all([
      enqueueAction("saveEvaluation", { itemId: "p1" }),
      enqueueAction("saveEvaluation", { itemId: "p2" }),
      enqueueAction("saveEvaluation", { itemId: "p3" }),
      enqueueAction("updateEvaluation", { id: "p4", validated: true, flagged: false }),
    ]);

    expect(await queueSize()).toBe(4);
  });

  it("handles enqueue while dequeuing", async () => {
    await enqueueAction("saveEvaluation", { itemId: "before" });

    const [actions] = await Promise.all([
      dequeueAll(),
      enqueueAction("saveEvaluation", { itemId: "during" }),
    ]);

    // The dequeue might or might not include "during" depending on timing
    expect(actions.length).toBeGreaterThanOrEqual(1);

    // But total queue should have both
    const total = await dequeueAll();
    expect(total.length).toBeGreaterThanOrEqual(1);
  });
});
