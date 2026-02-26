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
    await enqueueAction("updateEvaluation", { id: "a" });
    await enqueueAction("updateEvaluation", { id: "b" });

    const before = await dequeueAll();
    expect(before).toHaveLength(2);

    await removeAction(before[0].id!);
    const after = await dequeueAll();
    expect(after).toHaveLength(1);
    expect((after[0].payload as { id: string }).id).toBe("b");
  });

  it("increments retry count", async () => {
    await enqueueAction("updateEvaluation", { id: "x" });
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
    await enqueueAction("updateEvaluation", { id: "1" });
    await enqueueAction("saveEvaluation", { itemId: "2" });
    await enqueueAction("updateEvaluation", { id: "3" });

    expect(await queueSize()).toBe(3);
    await clearQueue();
    expect(await queueSize()).toBe(0);

    const actions = await dequeueAll();
    expect(actions).toHaveLength(0);
  });

  it("returns correct queue size", async () => {
    expect(await queueSize()).toBe(0);

    await enqueueAction("updateEvaluation", { id: "a" });
    expect(await queueSize()).toBe(1);

    await enqueueAction("saveEvaluation", { itemId: "b" });
    expect(await queueSize()).toBe(2);
  });

  it("preserves action order (FIFO)", async () => {
    await enqueueAction("updateEvaluation", { id: "first" });
    await enqueueAction("updateEvaluation", { id: "second" });
    await enqueueAction("updateEvaluation", { id: "third" });

    const actions = await dequeueAll();
    expect((actions[0].payload as { id: string }).id).toBe("first");
    expect((actions[1].payload as { id: string }).id).toBe("second");
    expect((actions[2].payload as { id: string }).id).toBe("third");
  });

  it("dequeueAll returns empty array when queue is empty", async () => {
    const actions = await dequeueAll();
    expect(actions).toEqual([]);
  });
});
