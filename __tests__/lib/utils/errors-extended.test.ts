/**
 * @jest-environment jsdom
 */
/**
 * Extended tests for errMsgShort and handleICSessionError.
 * The base errMsg function is covered in errors.test.ts.
 */
import { errMsgShort, handleICSessionError } from "@/lib/utils/errors";

describe("errMsgShort", () => {
  it("returns short message unchanged", () => {
    expect(errMsgShort(new Error("short"))).toBe("short");
  });

  it("returns exactly 120-char message unchanged", () => {
    const msg = "x".repeat(120);
    expect(errMsgShort(new Error(msg))).toBe(msg);
    expect(errMsgShort(new Error(msg)).length).toBe(120);
  });

  it("truncates 121-char message to 120 chars with ellipsis", () => {
    const msg = "x".repeat(121);
    const result = errMsgShort(new Error(msg));
    expect(result.length).toBe(120);
    expect(result).toBe("x".repeat(117) + "...");
  });

  it("truncates very long message", () => {
    const msg = "a".repeat(1000);
    const result = errMsgShort(new Error(msg));
    expect(result.length).toBe(120);
    expect(result.endsWith("...")).toBe(true);
  });

  it("handles empty error message", () => {
    expect(errMsgShort(new Error(""))).toBe("");
  });

  it("handles non-Error values", () => {
    expect(errMsgShort("plain string")).toBe("plain string");
    expect(errMsgShort(42)).toBe("42");
    expect(errMsgShort(null)).toBe("null");
  });

  it("truncates long non-Error string", () => {
    const long = "z".repeat(200);
    const result = errMsgShort(long);
    expect(result.length).toBe(120);
    expect(result).toBe("z".repeat(117) + "...");
  });

  it("handles IC hex cert data that caused overflow bug", () => {
    const hex = "d595985f44c42c92f99ac6e481b221ff5d70b17069e83b39a534b2d2dcccc140f1c92d227d904feb31fcbd1585f46077a7e3da97869e730e72440cf6ac3d88ed";
    const result = errMsgShort(new Error(hex));
    expect(result.length).toBe(120);
  });
});

describe("handleICSessionError", () => {
  let dispatchSpy: jest.SpyInstance;

  beforeEach(() => {
    dispatchSpy = jest.spyOn(window, "dispatchEvent").mockImplementation(() => true);
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  it("returns true and dispatches event for 'Invalid signature' error", () => {
    const result = handleICSessionError(new Error("Invalid signature: something failed"));
    expect(result).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("aegis:session-expired");
  });

  it("returns true for 'Invalid basic signature' error", () => {
    const result = handleICSessionError(new Error("Gateway returned: Invalid basic signature blah"));
    expect(result).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns false for unrelated errors", () => {
    expect(handleICSessionError(new Error("Network timeout"))).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("returns false for empty error", () => {
    expect(handleICSessionError(new Error(""))).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("returns false for null", () => {
    expect(handleICSessionError(null)).toBe(false);
  });

  it("returns false for non-Error string without signature keywords", () => {
    expect(handleICSessionError("Connection refused")).toBe(false);
  });

  it("returns true for non-Error string containing 'Invalid signature'", () => {
    expect(handleICSessionError("Error: Invalid signature")).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it("handles SSR environment (no window)", () => {
    const origWindow = globalThis.window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
    try {
      // Should return true (error matched) but not throw when dispatching
      const result = handleICSessionError(new Error("Invalid signature"));
      expect(result).toBe(true);
    } finally {
      globalThis.window = origWindow;
    }
  });

  it("does not dispatch for case-sensitive mismatch", () => {
    expect(handleICSessionError(new Error("invalid signature"))).toBe(false);
  });
});
