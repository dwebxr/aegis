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
      enqueueAction("saveEvaluation", { itemId: `tx-${i}` }, "p-test"),
    );
    await Promise.all(enqueues);
    expect(await queueSize()).toBe(20);
  });

  it("sequential operations preserve state across withDB calls", async () => {
    await enqueueAction("saveEvaluation", { itemId: "step-1" }, "p-test");
    await enqueueAction("updateEvaluation", { id: "step-2", validated: true, flagged: false }, "p-test");
    const actions = await dequeueAll("p-test");
    expect(actions).toHaveLength(2);

    await removeAction(actions[0].id!);
    expect(await queueSize()).toBe(1);

    await incrementRetries(actions[1].id!);
    const [remaining] = await dequeueAll("p-test");
    expect(remaining.retries).toBe(1);
    expect(remaining.type === "updateEvaluation" && remaining.payload.id).toBe("step-2");
  });

  it("clearQueue followed by immediate enqueue works", async () => {
    await enqueueAction("saveEvaluation", { itemId: "before" }, "p-test");
    await clearQueue();
    await enqueueAction("saveEvaluation", { itemId: "after" }, "p-test");

    const actions = await dequeueAll("p-test");
    expect(actions).toHaveLength(1);
    expect(actions[0].type === "saveEvaluation" && actions[0].payload.itemId).toBe("after");
  });

  it("multiple rapid clears don't corrupt state", async () => {
    await enqueueAction("saveEvaluation", { itemId: "x-1" }, "p-test");
    await Promise.all([clearQueue(), clearQueue(), clearQueue()]);
    expect(await queueSize()).toBe(0);
    await enqueueAction("saveEvaluation", { itemId: "x-2" }, "p-test");
    expect(await queueSize()).toBe(1);
  });

  it("incrementRetries on cleared queue is safe", async () => {
    await enqueueAction("saveEvaluation", { itemId: "will-clear" }, "p-test");
    const [action] = await dequeueAll("p-test");
    await clearQueue();
    // Increment on non-existent entry (was cleared) — should not throw
    await expect(incrementRetries(action.id!)).resolves.toBeUndefined();
  });

  it("removes all items one by one until empty", async () => {
    for (let i = 0; i < 5; i++) {
      await enqueueAction("saveEvaluation", { itemId: `idx-${i}` }, "p-test");
    }
    const all = await dequeueAll("p-test");
    for (const a of all) {
      await removeAction(a.id!);
    }
    expect(await queueSize()).toBe(0);
    expect(await dequeueAll("p-test")).toEqual([]);
  });

  it("preserves payload shape across structured clone", async () => {
    // saveEvaluation payload has a single string field — verifies the IDB
    // wrapper returns the same shape it stored, not a flattened or
    // mutated copy.
    await enqueueAction("saveEvaluation", { itemId: "shape-check" }, "p-test");
    const [action] = await dequeueAll("p-test");
    expect(action.type).toBe("saveEvaluation");
    expect(action.payload).toEqual({ itemId: "shape-check" });
  });

  it("preserves boolean flags in updateEvaluation payload", async () => {
    // updateEvaluation has two booleans — both must round-trip without
    // being coerced to numbers/strings by the storage layer.
    await enqueueAction("updateEvaluation", { id: "flags", validated: false, flagged: true }, "p-test");
    const [action] = await dequeueAll("p-test");
    expect(action.type).toBe("updateEvaluation");
    expect(action.payload).toEqual({ id: "flags", validated: false, flagged: true });
  });
});
