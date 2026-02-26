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

describe("actionQueue — concurrent operations", () => {
  it("handles multiple simultaneous enqueues", async () => {
    // Fire 10 enqueues concurrently
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        enqueueAction("saveEvaluation", { id: `concurrent-${i}` }),
      ),
    );
    const size = await queueSize();
    expect(size).toBe(10);

    const actions = await dequeueAll();
    expect(actions).toHaveLength(10);
    // All 10 unique payloads should be present
    const ids = new Set(actions.map(a => (a.payload as { id: string }).id));
    expect(ids.size).toBe(10);
  });

  it("handles enqueue + dequeue interleaved", async () => {
    await enqueueAction("saveEvaluation", { id: "first" });
    const mid = await dequeueAll();
    expect(mid).toHaveLength(1);

    await enqueueAction("saveEvaluation", { id: "second" });
    const all = await dequeueAll();
    expect(all).toHaveLength(2); // dequeueAll reads, does not remove
  });

  it("clearQueue during enqueue doesn't lose consistency", async () => {
    await enqueueAction("saveEvaluation", { id: "before-clear" });
    await clearQueue();
    await enqueueAction("saveEvaluation", { id: "after-clear" });

    const actions = await dequeueAll();
    expect(actions).toHaveLength(1);
    expect((actions[0].payload as { id: string }).id).toBe("after-clear");
  });
});

describe("actionQueue — large payloads", () => {
  it("stores and retrieves large payload", async () => {
    const largePayload = {
      text: "x".repeat(10_000),
      scores: { a: 1, b: 2, c: 3 },
      nested: { deep: { value: true } },
    };
    await enqueueAction("saveEvaluation", largePayload);
    const [action] = await dequeueAll();
    expect(action.payload).toEqual(largePayload);
  });

  it("stores payload with special characters", async () => {
    const payload = {
      text: "Unicode: こんにちは 🌍 émojis & <script>alert('xss')</script>",
      nullField: null,
      undefinedBehavior: undefined,
    };
    await enqueueAction("updateEvaluation", payload);
    const [action] = await dequeueAll();
    const retrieved = action.payload as typeof payload;
    expect(retrieved.text).toBe(payload.text);
    expect(retrieved.nullField).toBeNull();
  });
});

describe("actionQueue — non-existent IDs", () => {
  it("removeAction with non-existent ID does not throw", async () => {
    await expect(removeAction(99999)).resolves.toBeUndefined();
  });

  it("removeAction with non-existent ID does not affect existing entries", async () => {
    await enqueueAction("saveEvaluation", { id: "keep" });
    await removeAction(99999);
    const actions = await dequeueAll();
    expect(actions).toHaveLength(1);
    expect((actions[0].payload as { id: string }).id).toBe("keep");
  });

  it("incrementRetries with non-existent ID does not throw", async () => {
    await expect(incrementRetries(99999)).resolves.toBeUndefined();
  });

  it("incrementRetries with non-existent ID does not create entry", async () => {
    await incrementRetries(99999);
    expect(await queueSize()).toBe(0);
  });
});

describe("actionQueue — boundary conditions", () => {
  it("queueSize returns 0 for freshly cleared queue", async () => {
    await enqueueAction("saveEvaluation", { id: "temp" });
    await clearQueue();
    expect(await queueSize()).toBe(0);
  });

  it("dequeueAll returns entries with monotonically increasing IDs", async () => {
    await enqueueAction("saveEvaluation", { id: "a" });
    await enqueueAction("saveEvaluation", { id: "b" });
    await enqueueAction("saveEvaluation", { id: "c" });

    const actions = await dequeueAll();
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i].id!).toBeGreaterThan(actions[i - 1].id!);
    }
  });

  it("createdAt is a valid timestamp", async () => {
    const before = Date.now();
    await enqueueAction("saveEvaluation", { id: "ts-test" });
    const after = Date.now();

    const [action] = await dequeueAll();
    expect(action.createdAt).toBeGreaterThanOrEqual(before);
    expect(action.createdAt).toBeLessThanOrEqual(after);
  });

  it("retries starts at 0 and increments correctly up to high values", async () => {
    await enqueueAction("saveEvaluation", { id: "retry-test" });
    const [initial] = await dequeueAll();
    expect(initial.retries).toBe(0);

    // Increment 10 times
    for (let i = 0; i < 10; i++) {
      await incrementRetries(initial.id!);
    }
    const [updated] = await dequeueAll();
    expect(updated.retries).toBe(10);
  });

  it("supports both action types", async () => {
    await enqueueAction("saveEvaluation", { data: 1 });
    await enqueueAction("updateEvaluation", { data: 2 });

    const actions = await dequeueAll();
    expect(actions[0].type).toBe("saveEvaluation");
    expect(actions[1].type).toBe("updateEvaluation");
  });

  it("clearQueue is idempotent", async () => {
    await clearQueue();
    await clearQueue();
    await clearQueue();
    expect(await queueSize()).toBe(0);
  });
});

describe("actionQueue — remove + re-enqueue", () => {
  it("can remove and re-enqueue with same payload", async () => {
    await enqueueAction("saveEvaluation", { id: "reuse" });
    const [action] = await dequeueAll();
    await removeAction(action.id!);
    expect(await queueSize()).toBe(0);

    await enqueueAction("saveEvaluation", { id: "reuse" });
    const [newAction] = await dequeueAll();
    expect(newAction.id).not.toBe(action.id); // new auto-incremented ID
    expect((newAction.payload as { id: string }).id).toBe("reuse");
  });

  it("remove middle item preserves order of remaining", async () => {
    await enqueueAction("saveEvaluation", { order: 1 });
    await enqueueAction("saveEvaluation", { order: 2 });
    await enqueueAction("saveEvaluation", { order: 3 });

    const all = await dequeueAll();
    await removeAction(all[1].id!); // remove middle

    const remaining = await dequeueAll();
    expect(remaining).toHaveLength(2);
    expect((remaining[0].payload as { order: number }).order).toBe(1);
    expect((remaining[1].payload as { order: number }).order).toBe(3);
  });
});
