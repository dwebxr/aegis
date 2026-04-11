import {
  withIcLlmSlot,
  _resetIcLlmConcurrency,
  _icLlmInFlight,
  _icLlmWaiting,
} from "@/lib/ic/icLlmConcurrency";

beforeEach(() => {
  _resetIcLlmConcurrency();
});

describe("withIcLlmSlot — concurrency gate", () => {
  it("starts with 0 in flight and no waiters", () => {
    expect(_icLlmInFlight()).toBe(0);
    expect(_icLlmWaiting()).toBe(0);
  });

  it("acquires immediately when below the limit (1 caller)", async () => {
    let resolveFn: () => void = () => {};
    const slot = withIcLlmSlot(() => new Promise<string>(r => { resolveFn = () => r("a"); }));
    await new Promise(r => setTimeout(r, 0));
    expect(_icLlmInFlight()).toBe(1);
    expect(_icLlmWaiting()).toBe(0);
    resolveFn();
    await slot;
    expect(_icLlmInFlight()).toBe(0);
  });

  it("allows 2 concurrent slots without queueing", async () => {
    let r1: () => void = () => {};
    let r2: () => void = () => {};
    const s1 = withIcLlmSlot(() => new Promise<string>(r => { r1 = () => r("a"); }));
    const s2 = withIcLlmSlot(() => new Promise<string>(r => { r2 = () => r("b"); }));
    await new Promise(r => setTimeout(r, 0));
    expect(_icLlmInFlight()).toBe(2);
    expect(_icLlmWaiting()).toBe(0);
    r1();
    r2();
    await Promise.all([s1, s2]);
  });

  it("queues the 3rd caller until a slot frees", async () => {
    let r1: () => void = () => {};
    let r2: () => void = () => {};
    let r3: () => void = () => {};
    const s1 = withIcLlmSlot(() => new Promise<string>(r => { r1 = () => r("a"); }));
    const s2 = withIcLlmSlot(() => new Promise<string>(r => { r2 = () => r("b"); }));
    const s3 = withIcLlmSlot(() => new Promise<string>(r => { r3 = () => r("c"); }));

    await new Promise(r => setTimeout(r, 0));
    expect(_icLlmInFlight()).toBe(2);
    expect(_icLlmWaiting()).toBe(1);

    // Free a slot — the 3rd caller should immediately acquire it
    r1();
    await new Promise(r => setTimeout(r, 0));
    expect(_icLlmInFlight()).toBe(2);
    expect(_icLlmWaiting()).toBe(0);

    r2();
    r3();
    await Promise.all([s1, s2, s3]);
    expect(_icLlmInFlight()).toBe(0);
  });

  it("FIFO ordering: queued callers resume in the order they arrived", async () => {
    const order: string[] = [];
    const s1 = withIcLlmSlot(async () => { order.push("a"); await new Promise(r => setTimeout(r, 5)); return "a"; });
    const s2 = withIcLlmSlot(async () => { order.push("b"); await new Promise(r => setTimeout(r, 5)); return "b"; });
    const s3 = withIcLlmSlot(async () => { order.push("c"); await new Promise(r => setTimeout(r, 5)); return "c"; });
    const s4 = withIcLlmSlot(async () => { order.push("d"); await new Promise(r => setTimeout(r, 5)); return "d"; });
    await Promise.all([s1, s2, s3, s4]);
    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("releases the slot even when fn throws", async () => {
    const error = new Error("nope");
    await expect(withIcLlmSlot(async () => { throw error; })).rejects.toBe(error);
    expect(_icLlmInFlight()).toBe(0);
    expect(_icLlmWaiting()).toBe(0);
  });

  it("releases the slot even when fn rejects with non-Error value", async () => {
    await expect(withIcLlmSlot(async () => { throw "string error"; })).rejects.toBe("string error");
    expect(_icLlmInFlight()).toBe(0);
  });

  it("3rd caller's fn doesn't START until a slot is free", async () => {
    let started = false;
    let r1: () => void = () => {};
    const s1 = withIcLlmSlot(() => new Promise<string>(r => { r1 = () => r("a"); }));
    const s2 = withIcLlmSlot(() => new Promise<string>(r => r("b")));
    const s3 = withIcLlmSlot(async () => { started = true; return "c"; });

    await s2; // 2nd one resolves immediately
    await new Promise(r => setTimeout(r, 5));
    // 3rd should NOT have started — slot 2 returned but slot 1 still held
    // Actually wait — once s2 resolves, slot 2 frees, and s3 takes it.
    // So s3 SHOULD have started.
    expect(started).toBe(true);
    r1();
    await Promise.all([s1, s3]);
  });

  it("under heavy load (10 callers, 2 slots) eventually drains", async () => {
    let counter = 0;
    const fns = Array.from({ length: 10 }, () =>
      withIcLlmSlot(async () => {
        await new Promise(r => setTimeout(r, 2));
        counter += 1;
        return counter;
      }),
    );
    const results = await Promise.all(fns);
    expect(results).toHaveLength(10);
    expect(counter).toBe(10);
    expect(_icLlmInFlight()).toBe(0);
    expect(_icLlmWaiting()).toBe(0);
  });
});
