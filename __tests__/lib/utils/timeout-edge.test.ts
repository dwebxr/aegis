import { withTimeout } from "@/lib/utils/timeout";

describe("withTimeout — concurrent and edge cases", () => {
  describe("concurrent races", () => {
    it("handles multiple concurrent withTimeout calls independently", async () => {
      const fast = withTimeout(
        new Promise<string>(resolve => setTimeout(() => resolve("fast"), 10)),
        1000,
      );
      const slow = withTimeout(
        new Promise<string>(resolve => setTimeout(() => resolve("slow"), 500)),
        1000,
      );

      const results = await Promise.all([fast, slow]);
      expect(results).toEqual(["fast", "slow"]);
    });

    it("one timing out does not affect another", async () => {
      const willTimeout = withTimeout(
        new Promise<string>(resolve => setTimeout(() => resolve("late"), 500)),
        10,
        "timed-out",
      );
      const willSucceed = withTimeout(Promise.resolve("ok"), 1000);

      const [timeoutResult, successResult] = await Promise.allSettled([willTimeout, willSucceed]);

      expect(timeoutResult.status).toBe("rejected");
      expect(successResult.status).toBe("fulfilled");
      if (successResult.status === "fulfilled") {
        expect(successResult.value).toBe("ok");
      }
    });
  });

  describe("edge timing", () => {
    it("resolves with 0ms timeout if promise is already resolved", async () => {
      // Promise.resolve() is already settled
      const result = await withTimeout(Promise.resolve("instant"), 0);
      expect(result).toBe("instant");
    });

    it("rejects with 0ms timeout if promise is pending", async () => {
      const neverResolve = new Promise<string>(() => {});
      await expect(withTimeout(neverResolve, 0)).rejects.toThrow("timeout");
    });

    it("handles very short timeout (1ms)", async () => {
      const slow = new Promise<string>(resolve => setTimeout(() => resolve("slow"), 1000));
      await expect(withTimeout(slow, 1, "too-slow")).rejects.toThrow("too-slow");
    });
  });

  describe("error propagation", () => {
    it("propagates non-Error rejection values", async () => {
      const badPromise = Promise.reject("string-error");
      try {
        await withTimeout(badPromise, 1000);
        fail("should have thrown");
      } catch (e) {
        expect(e).toBe("string-error");
      }
    });

    it("propagates rejection with complex error objects", async () => {
      const err = new TypeError("type mismatch");
      const badPromise = Promise.reject(err);
      await expect(withTimeout(badPromise, 1000)).rejects.toThrow("type mismatch");
      await expect(withTimeout(badPromise, 1000)).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe("return types", () => {
    it("preserves typed return values", async () => {
      const numPromise = withTimeout(Promise.resolve(42), 1000);
      const result: number = await numPromise;
      expect(result).toBe(42);
    });

    it("preserves object return values", async () => {
      const obj = { key: "value", nested: { a: 1 } };
      const result = await withTimeout(Promise.resolve(obj), 1000);
      expect(result).toEqual(obj);
    });

    it("preserves null and undefined return values", async () => {
      expect(await withTimeout(Promise.resolve(null), 1000)).toBeNull();
      expect(await withTimeout(Promise.resolve(undefined), 1000)).toBeUndefined();
    });
  });

  describe("late rejection suppression", () => {
    it("does not cause unhandled rejection when promise rejects after timeout", async () => {
      // This tests that promise.catch(() => {}) prevents unhandled rejections
      let rejectFn: (reason: Error) => void;
      const promise = new Promise<never>((_, reject) => {
        rejectFn = reject;
      });

      // Timeout will win
      await expect(withTimeout(promise, 10)).rejects.toThrow("timeout");

      // Late rejection should be suppressed (no unhandled rejection event)
      rejectFn!(new Error("late rejection"));

      // If we get here without process crash, the test passes
      // Give event loop a tick to process the rejection
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });
});
