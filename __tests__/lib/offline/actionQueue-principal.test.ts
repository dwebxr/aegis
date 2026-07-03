/**
 * Principal-scoped offline queue — prevents cross-account replay (User A's pending
 * action drained while logged in as User B would tag the item with B as owner on the
 * canister). dequeueAll is NON-DESTRUCTIVE: it RETURNS only the requested principal's
 * entries and LEAVES every other entry in place (so A's actions survive until A logs
 * back in). The principal filter alone prevents replay — deleting other entries only
 * caused silent data loss on shared devices.
 *
 * Uses fake-indexeddb to exercise the real IDB layer end-to-end.
 */
import "fake-indexeddb/auto";
import {
  enqueueAction,
  dequeueAll,
  clearQueue,
  queueSize,
  removeAction,
} from "@/lib/offline/actionQueue";

beforeEach(async () => {
  await clearQueue();
});

describe("dequeueAll — principal filtering", () => {
  it("returns only the requested principal's entries", async () => {
    await enqueueAction("saveEvaluation", { itemId: "a1" }, "alice");
    await enqueueAction("saveEvaluation", { itemId: "b1" }, "bob");
    await enqueueAction("saveEvaluation", { itemId: "a2" }, "alice");

    const aliceQueue = await dequeueAll("alice");
    expect(aliceQueue.map((a) => (a.type === "saveEvaluation" ? a.payload.itemId : ""))).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("preserves entries belonging to other principals (non-destructive dequeue)", async () => {
    await enqueueAction("saveEvaluation", { itemId: "a1" }, "alice");
    await enqueueAction("saveEvaluation", { itemId: "b1" }, "bob");
    expect(await queueSize()).toBe(2);

    await dequeueAll("alice");

    // Bob's entry is NOT purged — it survives until Bob logs back in. No replay risk
    // since dequeueAll only RETURNS the matching principal's actions.
    expect(await queueSize()).toBe(2);
    const bobQueue = await dequeueAll("bob");
    expect(bobQueue).toHaveLength(1);
    expect(bobQueue[0].type === "saveEvaluation" && bobQueue[0].payload.itemId).toBe("b1");
  });

  it("preserves legacy entries with missing principal (not drained, not deleted)", async () => {
    // Simulate a legacy entry written before principal-scoping landed.
    // openDB is internal — replicate by enqueuing then mutating? Simpler:
    // open a raw IDB transaction and write a legacy-shaped record.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("aegis-offline-queue", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("pending-actions")) {
          db.createObjectStore("pending-actions", { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("pending-actions", "readwrite");
        tx.objectStore("pending-actions").add({
          type: "saveEvaluation",
          payload: { itemId: "legacy-x" },
          createdAt: Date.now(),
          retries: 0,
          // intentionally NO principal field
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });

    expect(await queueSize()).toBe(1);
    const drained = await dequeueAll("alice");
    expect(drained).toEqual([]); // legacy entry is NOT attributed to alice
    expect(await queueSize()).toBe(1); // and NOT deleted — it survives (no misattribution, no loss)
  });

  it("dequeueAll(null) is a no-op — does NOT wipe other principals' data", async () => {
    await enqueueAction("saveEvaluation", { itemId: "a1" }, "alice");
    await enqueueAction("saveEvaluation", { itemId: "b1" }, "bob");
    expect(await queueSize()).toBe(2);

    const result = await dequeueAll(null);
    expect(result).toEqual([]);
    expect(await queueSize()).toBe(2); // untouched

    // Alice can still drain her own entries afterwards
    const aliceQueue = await dequeueAll("alice");
    expect(aliceQueue).toHaveLength(1);
  });

  it("returns empty array when principal has no entries", async () => {
    await enqueueAction("saveEvaluation", { itemId: "b1" }, "bob");
    expect(await dequeueAll("alice")).toEqual([]);
  });

  it("preserves entry ordering (FIFO via auto-increment id)", async () => {
    await enqueueAction("saveEvaluation", { itemId: "first" }, "alice");
    await enqueueAction("updateEvaluation", { id: "second", validated: true, flagged: false }, "alice");
    await enqueueAction("saveEvaluation", { itemId: "third" }, "alice");

    const drained = await dequeueAll("alice");
    expect(drained.map((a) => (a.type === "saveEvaluation" ? a.payload.itemId : a.payload.id))).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("preserves discriminated-union typing for mixed action types", async () => {
    await enqueueAction("saveEvaluation", { itemId: "x" }, "alice");
    await enqueueAction("updateEvaluation", { id: "y", validated: false, flagged: true }, "alice");

    const drained = await dequeueAll("alice");
    expect(drained).toHaveLength(2);
    expect(drained[0].type).toBe("saveEvaluation");
    expect(drained[1].type).toBe("updateEvaluation");
    if (drained[1].type === "updateEvaluation") {
      expect(drained[1].payload).toEqual({ id: "y", validated: false, flagged: true });
    }
  });

  it("retries field is initialized to 0", async () => {
    await enqueueAction("saveEvaluation", { itemId: "x" }, "alice");
    const [action] = await dequeueAll("alice");
    expect(action.retries).toBe(0);
  });

  it("removeAction by id works after principal-filtered dequeue", async () => {
    await enqueueAction("saveEvaluation", { itemId: "x" }, "alice");
    const [action] = await dequeueAll("alice");
    expect(action.id).toBeDefined();
    await removeAction(action.id!);
    expect(await dequeueAll("alice")).toEqual([]);
  });

  it("handles concurrent enqueues from multiple principals (single drainer wins)", async () => {
    await Promise.all([
      enqueueAction("saveEvaluation", { itemId: "a1" }, "alice"),
      enqueueAction("saveEvaluation", { itemId: "b1" }, "bob"),
      enqueueAction("saveEvaluation", { itemId: "a2" }, "alice"),
      enqueueAction("saveEvaluation", { itemId: "c1" }, "carol"),
      enqueueAction("saveEvaluation", { itemId: "b2" }, "bob"),
    ]);
    expect(await queueSize()).toBe(5);

    // alice drains — gets her own entries; bob/carol entries are PRESERVED.
    const aliceQueue = await dequeueAll("alice");
    expect(aliceQueue).toHaveLength(2);
    const aliceIds = aliceQueue.map((a) => (a.type === "saveEvaluation" ? a.payload.itemId : "")).sort();
    expect(aliceIds).toEqual(["a1", "a2"]);

    // Queue still holds all 5 — dequeueAll is non-destructive; bob/carol can drain later.
    expect(await queueSize()).toBe(5);
    expect(await dequeueAll("bob")).toHaveLength(2);
    expect(await dequeueAll("carol")).toHaveLength(1);
  });

  it("interleaved enqueue + dequeue is safe (no lost updates for active principal)", async () => {
    await enqueueAction("saveEvaluation", { itemId: "a1" }, "alice");
    const first = await dequeueAll("alice");
    expect(first).toHaveLength(1);

    // Subsequent enqueue still visible to the same principal.
    await enqueueAction("saveEvaluation", { itemId: "a2" }, "alice");
    const second = await dequeueAll("alice");
    expect(second).toHaveLength(2); // dequeueAll reads + filters, doesn't remove matches
  });
});

describe("enqueueAction — payload integrity per-principal", () => {
  it("preserves principal across enqueue/dequeue round-trip", async () => {
    await enqueueAction("saveEvaluation", { itemId: "x" }, "alice-principal-text");
    const [action] = await dequeueAll("alice-principal-text");
    expect(action.principal).toBe("alice-principal-text");
  });

  it("treats principals as exact-match strings (case-sensitive)", async () => {
    await enqueueAction("saveEvaluation", { itemId: "x" }, "Alice");
    // Wrong-case lookup returns [] but does NOT purge the entry (non-destructive) —
    // the canonical-case drain afterwards still sees it. Client code must still use a
    // stable principal string (Principal.toText() is deterministic).
    expect(await dequeueAll("alice")).toEqual([]);
    const drained = await dequeueAll("Alice");
    expect(drained).toHaveLength(1);
    expect(drained[0].type === "saveEvaluation" && drained[0].payload.itemId).toBe("x");
  });

  it("preserves Alice's entry when only Alice queries (no wrong-case purge)", async () => {
    await enqueueAction("saveEvaluation", { itemId: "x" }, "Alice");
    const drained = await dequeueAll("Alice");
    expect(drained).toHaveLength(1);
    expect(drained[0].principal).toBe("Alice");
  });
});
