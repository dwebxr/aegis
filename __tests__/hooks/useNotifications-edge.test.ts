import { shouldSuppressDuplicate, computeDismissDuration, DEDUPE_WINDOW_MS } from "@/hooks/useNotifications";

describe("shouldSuppressDuplicate", () => {
  it("never suppresses non-error notifications", () => {
    const map = new Map<string, number>();
    expect(shouldSuppressDuplicate(map, "msg", "success", 1000)).toBe(false);
    expect(shouldSuppressDuplicate(map, "msg", "success", 1001)).toBe(false);
    expect(shouldSuppressDuplicate(map, "msg", "info", 1002)).toBe(false);
  });

  it("suppresses duplicate error within dedupe window", () => {
    const map = new Map<string, number>();
    const now = Date.now();
    expect(shouldSuppressDuplicate(map, "Error X", "error", now)).toBe(false);
    expect(shouldSuppressDuplicate(map, "Error X", "error", now + 1000)).toBe(true);
    expect(shouldSuppressDuplicate(map, "Error X", "error", now + DEDUPE_WINDOW_MS - 1)).toBe(true);
  });

  it("allows same error after dedupe window expires", () => {
    const map = new Map<string, number>();
    const now = Date.now();
    expect(shouldSuppressDuplicate(map, "Error X", "error", now)).toBe(false);
    expect(shouldSuppressDuplicate(map, "Error X", "error", now + DEDUPE_WINDOW_MS)).toBe(false);
  });

  it("tracks different error messages independently", () => {
    const map = new Map<string, number>();
    const now = Date.now();
    expect(shouldSuppressDuplicate(map, "Error A", "error", now)).toBe(false);
    expect(shouldSuppressDuplicate(map, "Error B", "error", now)).toBe(false);
    expect(shouldSuppressDuplicate(map, "Error A", "error", now + 1000)).toBe(true);
    expect(shouldSuppressDuplicate(map, "Error B", "error", now + 1000)).toBe(true);
  });

  it("updates timestamp on non-suppressed error", () => {
    const map = new Map<string, number>();
    shouldSuppressDuplicate(map, "Error X", "error", 1000);
    expect(map.get("Error X")).toBe(1000);

    // After window expires, should update timestamp
    shouldSuppressDuplicate(map, "Error X", "error", 1000 + DEDUPE_WINDOW_MS);
    expect(map.get("Error X")).toBe(1000 + DEDUPE_WINDOW_MS);
  });

  it("handles empty string message", () => {
    const map = new Map<string, number>();
    expect(shouldSuppressDuplicate(map, "", "error", 1000)).toBe(false);
    expect(shouldSuppressDuplicate(map, "", "error", 1001)).toBe(true);
  });
});

describe("computeDismissDuration", () => {
  it("returns 30000ms for error notifications", () => {
    expect(computeDismissDuration("error")).toBe(30000);
  });

  it("returns 2500ms for success notifications", () => {
    expect(computeDismissDuration("success")).toBe(2500);
  });

  it("returns 2500ms for info notifications", () => {
    expect(computeDismissDuration("info")).toBe(2500);
  });
});
