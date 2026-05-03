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

describe("actionQueue", () => {
  it("enqueues and dequeues actions", async () => {
    await enqueueAction("updateEvaluation", { id: "abc", validated: true, flagged: false });
    await enqueueAction("saveEvaluation", { itemId: "def" });

    const actions = await dequeueAll();
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe("updateEvaluation");
    expect(actions[0].payload).toEqual({ id: "abc", validated: true, flagged: false });
    expect(actions[0].retries).toBe(0);
    expect(actions[0].createdAt).toBeGreaterThan(0);
    expect(actions[1].type).toBe("saveEvaluation");
    expect(actions[1].payload).toEqual({ itemId: "def" });
  });

  it("removes individual actions by id", async () => {
    await enqueueAction("updateEvaluation", { id: "a", validated: true, flagged: false });
    await enqueueAction("updateEvaluation", { id: "b", validated: false, flagged: true });

    const before = await dequeueAll();
    expect(before).toHaveLength(2);

    await removeAction(before[0].id!);
    const after = await dequeueAll();
    expect(after).toHaveLength(1);
    expect(after[0].type === "updateEvaluation" && after[0].payload.id).toBe("b");
  });

  it("increments retry count", async () => {
    await enqueueAction("updateEvaluation", { id: "x", validated: true, flagged: false });
    const [action] = await dequeueAll();
    expect(action.retries).toBe(0);

    await incrementRetries(action.id!);
    const [updated] = await dequeueAll();
    expect(updated.retries).toBe(1);

    await incrementRetries(action.id!);
    const [updated2] = await dequeueAll();
    expect(updated2.retries).toBe(2);
  });

  it("clears the entire queue", async () => {
    await enqueueAction("updateEvaluation", { id: "1", validated: true, flagged: false });
    await enqueueAction("saveEvaluation", { itemId: "2" });
    await enqueueAction("updateEvaluation", { id: "3", validated: false, flagged: true });

    expect(await queueSize()).toBe(3);
    await clearQueue();
    expect(await queueSize()).toBe(0);

    const actions = await dequeueAll();
    expect(actions).toHaveLength(0);
  });

  it("returns correct queue size", async () => {
    expect(await queueSize()).toBe(0);

    await enqueueAction("updateEvaluation", { id: "a", validated: true, flagged: false });
    expect(await queueSize()).toBe(1);

    await enqueueAction("saveEvaluation", { itemId: "b" });
    expect(await queueSize()).toBe(2);
  });

  it("preserves action order (FIFO)", async () => {
    await enqueueAction("updateEvaluation", { id: "first", validated: true, flagged: false });
    await enqueueAction("updateEvaluation", { id: "second", validated: true, flagged: false });
    await enqueueAction("updateEvaluation", { id: "third", validated: true, flagged: false });

    const actions = await dequeueAll();
    expect(actions[0].type === "updateEvaluation" && actions[0].payload.id).toBe("first");
    expect(actions[1].type === "updateEvaluation" && actions[1].payload.id).toBe("second");
    expect(actions[2].type === "updateEvaluation" && actions[2].payload.id).toBe("third");
  });

  it("dequeueAll returns empty array when queue is empty", async () => {
    const actions = await dequeueAll();
    expect(actions).toEqual([]);
  });
});
