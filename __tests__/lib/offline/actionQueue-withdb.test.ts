/**
 * Tests for the withDB refactored actionQueue.
 * Validates that the withDB helper correctly handles transactions.
 * Uses fake-indexeddb for real IndexedDB operations in Node.js.
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

describe("actionQueue withDB refactor — transaction integrity", () => {
  it("concurrent enqueue and queueSize are consistent", async () => {
    const enqueues = Array.from({ length: 20 }, (_, i) =>
      enqueueAction("saveEvaluation", { id: `tx-${i}` }),
    );
    await Promise.all(enqueues);
    expect(await queueSize()).toBe(20);
  });

  it("sequential operations preserve state across withDB calls", async () => {
    await enqueueAction("saveEvaluation", { step: 1 });
    await enqueueAction("updateEvaluation", { step: 2 });
    const actions = await dequeueAll();
    expect(actions).toHaveLength(2);

    await removeAction(actions[0].id!);
    expect(await queueSize()).toBe(1);

    await incrementRetries(actions[1].id!);
    const [remaining] = await dequeueAll();
    expect(remaining.retries).toBe(1);
    expect((remaining.payload as { step: number }).step).toBe(2);
  });

  it("clearQueue followed by immediate enqueue works", async () => {
    await enqueueAction("saveEvaluation", { data: "before" });
    await clearQueue();
    await enqueueAction("saveEvaluation", { data: "after" });

    const actions = await dequeueAll();
    expect(actions).toHaveLength(1);
    expect((actions[0].payload as { data: string }).data).toBe("after");
  });

  it("multiple rapid clears don't corrupt state", async () => {
    await enqueueAction("saveEvaluation", { x: 1 });
    await Promise.all([clearQueue(), clearQueue(), clearQueue()]);
    expect(await queueSize()).toBe(0);
    await enqueueAction("saveEvaluation", { x: 2 });
    expect(await queueSize()).toBe(1);
  });

  it("incrementRetries on cleared queue is safe", async () => {
    await enqueueAction("saveEvaluation", { id: "will-clear" });
    const [action] = await dequeueAll();
    await clearQueue();
    // Increment on non-existent entry (was cleared) — should not throw
    await expect(incrementRetries(action.id!)).resolves.toBeUndefined();
  });

  it("removes all items one by one until empty", async () => {
    for (let i = 0; i < 5; i++) {
      await enqueueAction("saveEvaluation", { idx: i });
    }
    const all = await dequeueAll();
    for (const a of all) {
      await removeAction(a.id!);
    }
    expect(await queueSize()).toBe(0);
    expect(await dequeueAll()).toEqual([]);
  });

  it("handles empty payload objects", async () => {
    await enqueueAction("saveEvaluation", {});
    const [action] = await dequeueAll();
    expect(action.payload).toEqual({});
    expect(action.type).toBe("saveEvaluation");
  });

  it("handles null payload", async () => {
    await enqueueAction("saveEvaluation", null);
    const [action] = await dequeueAll();
    expect(action.payload).toBeNull();
  });

  it("handles array payload", async () => {
    await enqueueAction("saveEvaluation", [1, 2, 3]);
    const [action] = await dequeueAll();
    expect(action.payload).toEqual([1, 2, 3]);
  });

  it("handles deeply nested payload", async () => {
    const deep = { a: { b: { c: { d: { e: "value" } } } } };
    await enqueueAction("saveEvaluation", deep);
    const [action] = await dequeueAll();
    expect(action.payload).toEqual(deep);
  });
});
