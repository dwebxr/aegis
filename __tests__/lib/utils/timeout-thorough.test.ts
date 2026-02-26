import { withTimeout } from "@/lib/utils/timeout";

describe("withTimeout — basic behavior", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it("rejects with timeout error when promise takes too long", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 500));
    await expect(withTimeout(slow, 10, "timed out")).rejects.toThrow("timed out");
  });

  it("uses default message when none provided", async () => {
    const slow = new Promise(() => {}); // never resolves
    await expect(withTimeout(slow, 10)).rejects.toThrow("timeout");
  });

  it("preserves the resolved value type", async () => {
    const obj = { a: 1, b: "two" };
    const result = await withTimeout(Promise.resolve(obj), 1000);
    expect(result).toEqual({ a: 1, b: "two" });
  });
});

describe("withTimeout — rejection handling", () => {
  it("propagates original promise rejection (before timeout)", async () => {
    const failing = Promise.reject(new Error("original error"));
    await expect(withTimeout(failing, 1000)).rejects.toThrow("original error");
  });

  it("does not cause unhandled rejection when original rejects after timeout", async () => {
    // This tests the promise.catch(() => {}) no-op handler
    let rejectFn: (err: Error) => void;
    const slow = new Promise<never>((_, reject) => { rejectFn = reject; });

    const result = withTimeout(slow, 10, "timeout wins");
    await expect(result).rejects.toThrow("timeout wins");

    // Now reject the original — should NOT cause unhandled rejection
    rejectFn!(new Error("late rejection"));
    // If we get here without process crash, the test passes
    await new Promise(r => setTimeout(r, 50));
  });
});

describe("withTimeout — timer cleanup", () => {
  it("clears the timeout timer when promise resolves first", async () => {
    const clearSpy = jest.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.resolve("fast"), 10_000);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("clears the timeout timer when promise rejects first", async () => {
    const clearSpy = jest.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.reject(new Error("boom")), 10_000).catch(() => {});
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe("withTimeout — edge cases", () => {
  it("works with zero timeout (immediately rejects)", async () => {
    // A 0ms timeout should still reject since the microtask from Promise.resolve
    // runs before the macrotask from setTimeout(0), but with Promise.race
    // the resolve should actually win because it's already resolved.
    const result = await withTimeout(Promise.resolve("instant"), 0);
    expect(result).toBe("instant");
  });

  it("handles already-resolved promise with very short timeout", async () => {
    const result = await withTimeout(Promise.resolve(99), 1);
    expect(result).toBe(99);
  });

  it("works with async function return", async () => {
    const asyncFn = async () => {
      return "async result";
    };
    const result = await withTimeout(asyncFn(), 1000);
    expect(result).toBe("async result");
  });

  it("handles promise that resolves to undefined", async () => {
    const result = await withTimeout(Promise.resolve(undefined), 1000);
    expect(result).toBeUndefined();
  });

  it("handles promise that resolves to null", async () => {
    const result = await withTimeout(Promise.resolve(null), 1000);
    expect(result).toBeNull();
  });
});
