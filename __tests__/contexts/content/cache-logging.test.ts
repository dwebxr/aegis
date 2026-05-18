/**
 * @jest-environment jsdom
 *
 * Verifies that the silent-catch fixes in clearCachedContent actually emit
 * `console.warn` on failure. Sentry's captureConsoleIntegration forwards
 * warn+error to prod observability, so an uncaught throw inside the catch
 * would manifest as missing alerts on IDB/localStorage problems.
 */
import "fake-indexeddb/auto";
import { clearCachedContent } from "@/contexts/content/cache";

// Polyfill structuredClone for fake-indexeddb under jsdom.
if (typeof globalThis.structuredClone !== "function") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const v8 = require("node:v8") as typeof import("node:v8");
  globalThis.structuredClone = ((v: unknown) =>
    v8.deserialize(v8.serialize(v))) as typeof globalThis.structuredClone;
}

beforeEach(() => {
  // jest.setup.ts replaces console.warn with a noop — spy on it per test.
  jest.restoreAllMocks();
});

describe("clearCachedContent — error logging", () => {
  it("logs a warn when localStorage.removeItem throws", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const removeItem = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    await clearCachedContent("alice");

    expect(warn).toHaveBeenCalled();
    const message = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(message).toMatch(/localStorage remove failed/);
    expect(message).toMatch(/quota exceeded/);

    removeItem.mockRestore();
    warn.mockRestore();
  });

  it("logs a warn when IDB delete rejects", async () => {
    // Force idbDelete to reject by mocking the module.
    jest.resetModules();
    jest.doMock("@/lib/storage/idb", () => {
      const actual = jest.requireActual("@/lib/storage/idb");
      return {
        ...actual,
        isIDBAvailable: () => true,
        idbDelete: jest.fn().mockRejectedValue(new Error("DB closed")),
      };
    });
    const { clearCachedContent: clearReloaded } = await import("@/contexts/content/cache");

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await clearReloaded("bob");

    const message = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(message).toMatch(/IDB delete failed/);
    expect(message).toMatch(/DB closed/);

    warn.mockRestore();
    jest.dontMock("@/lib/storage/idb");
    jest.resetModules();
  });

  it("does NOT throw when both stores fail (continues to next key)", async () => {
    const removeItem = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage error");
    });
    // Should not propagate the error to the caller — logout path must always succeed.
    await expect(clearCachedContent("c")).resolves.not.toThrow();
    removeItem.mockRestore();
  });
});
