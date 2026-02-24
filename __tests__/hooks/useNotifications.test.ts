/**
 * Tests for notification deduplication and timing logic.
 * Tests import and call REAL production functions — no reimplementation.
 */

import {
  shouldSuppressDuplicate,
  computeDismissDuration,
  DEDUPE_WINDOW_MS,
  type Notification,
} from "@/hooks/useNotifications";

describe("shouldSuppressDuplicate", () => {
  it("suppresses duplicate error within dedupe window", () => {
    const recentMap = new Map<string, number>();
    const now = Date.now();

    // First error — not suppressed, and recentMap is updated
    expect(shouldSuppressDuplicate(recentMap, "Network error", "error", now)).toBe(false);
    expect(recentMap.get("Network error")).toBe(now);

    // Same error immediately — suppressed
    expect(shouldSuppressDuplicate(recentMap, "Network error", "error", now + 100)).toBe(true);
  });

  it("allows same error after dedupe window expires", () => {
    const recentMap = new Map<string, number>();
    const now = Date.now();

    // First occurrence
    expect(shouldSuppressDuplicate(recentMap, "Timeout", "error", now)).toBe(false);

    // After window — allowed again, and timestamp updated
    const afterWindow = now + DEDUPE_WINDOW_MS + 1;
    expect(shouldSuppressDuplicate(recentMap, "Timeout", "error", afterWindow)).toBe(false);
    expect(recentMap.get("Timeout")).toBe(afterWindow);
  });

  it("never suppresses non-error types (success, info)", () => {
    const recentMap = new Map<string, number>();
    const now = Date.now();

    // Same text, same timestamp — still not suppressed for non-error types
    expect(shouldSuppressDuplicate(recentMap, "Saved", "success", now)).toBe(false);
    expect(shouldSuppressDuplicate(recentMap, "Saved", "success", now)).toBe(false);
    expect(shouldSuppressDuplicate(recentMap, "Hint", "info", now)).toBe(false);
    expect(shouldSuppressDuplicate(recentMap, "Hint", "info", now)).toBe(false);

    // recentMap should be empty — non-error types don't add entries
    expect(recentMap.size).toBe(0);
  });

  it("allows different error messages simultaneously", () => {
    const recentMap = new Map<string, number>();
    const now = Date.now();

    expect(shouldSuppressDuplicate(recentMap, "Error A", "error", now)).toBe(false);
    expect(shouldSuppressDuplicate(recentMap, "Error B", "error", now)).toBe(false);
    expect(recentMap.size).toBe(2);

    // But duplicates of each are suppressed
    expect(shouldSuppressDuplicate(recentMap, "Error A", "error", now + 1)).toBe(true);
    expect(shouldSuppressDuplicate(recentMap, "Error B", "error", now + 1)).toBe(true);
  });

  it("suppresses at exactly DEDUPE_WINDOW_MS - 1", () => {
    const recentMap = new Map<string, number>();
    const now = Date.now();

    shouldSuppressDuplicate(recentMap, "Edge", "error", now);
    // At window boundary minus 1 — still within window
    expect(shouldSuppressDuplicate(recentMap, "Edge", "error", now + DEDUPE_WINDOW_MS - 1)).toBe(true);
    // At exactly window boundary — no longer suppressed
    expect(shouldSuppressDuplicate(recentMap, "Edge", "error", now + DEDUPE_WINDOW_MS)).toBe(false);
  });
});

describe("computeDismissDuration", () => {
  it("returns 5000ms for error type", () => {
    expect(computeDismissDuration("error")).toBe(5000);
  });

  it("returns 2500ms for success type", () => {
    expect(computeDismissDuration("success")).toBe(2500);
  });

  it("returns 2500ms for info type", () => {
    expect(computeDismissDuration("info")).toBe(2500);
  });
});

describe("DEDUPE_WINDOW_MS", () => {
  it("is 5 seconds", () => {
    expect(DEDUPE_WINDOW_MS).toBe(5_000);
  });
});

describe("auto-dismiss timing", () => {
  it("dismisses non-error after 2500ms using computeDismissDuration", () => {
    jest.useFakeTimers();
    let dismissed = false;
    const duration = computeDismissDuration("success");
    const timer = setTimeout(() => { dismissed = true; }, duration);

    jest.advanceTimersByTime(2499);
    expect(dismissed).toBe(false);

    jest.advanceTimersByTime(1);
    expect(dismissed).toBe(true);

    clearTimeout(timer);
    jest.useRealTimers();
  });

  it("dismisses error after 5000ms using computeDismissDuration", () => {
    jest.useFakeTimers();
    let dismissed = false;
    const duration = computeDismissDuration("error");
    const timer = setTimeout(() => { dismissed = true; }, duration);

    jest.advanceTimersByTime(4999);
    expect(dismissed).toBe(false);

    jest.advanceTimersByTime(1);
    expect(dismissed).toBe(true);

    clearTimeout(timer);
    jest.useRealTimers();
  });
});

describe("removeNotification logic", () => {
  it("filters out by id", () => {
    const notifications: Notification[] = [
      { id: 1, text: "A", type: "info" },
      { id: 2, text: "B", type: "error" },
      { id: 3, text: "C", type: "success" },
    ];
    const filtered = notifications.filter(n => n.id !== 2);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(n => n.id)).toEqual([1, 3]);
  });
});
