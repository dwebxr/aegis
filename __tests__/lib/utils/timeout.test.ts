import { withTimeout } from "@/lib/utils/timeout";

describe("withTimeout", () => {
  it("resolves when promise settles before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000);
    expect(result).toBe("ok");
  });

  it("rejects with timeout error when promise exceeds timeout", async () => {
    let timer: ReturnType<typeof setTimeout>;
    const slow = new Promise<string>((resolve) => { timer = setTimeout(() => resolve("late"), 5000); });
    await expect(withTimeout(slow, 50)).rejects.toThrow("timeout");
    clearTimeout(timer!);
  });

  it("uses custom error message", async () => {
    let timer: ReturnType<typeof setTimeout>;
    const slow = new Promise<string>((resolve) => { timer = setTimeout(() => resolve("late"), 5000); });
    await expect(withTimeout(slow, 50, "custom-msg")).rejects.toThrow("custom-msg");
    clearTimeout(timer!);
  });

  it("rejects with promise error if promise rejects before timeout", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });

  it("clears timer when promise resolves first (no leaked handles)", async () => {
    const spy = jest.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.resolve("ok"), 5000);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("clears timer when promise rejects first", async () => {
    const spy = jest.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.reject(new Error("fail")), 5000).catch(() => {});
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
