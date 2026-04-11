/**
 * @jest-environment jsdom
 */
/**
 * Thorough tests for useNotifications hook — covers add/remove,
 * dedup suppression, auto-dismiss timing, and concurrent notifications.
 */
import { renderHook, act } from "@testing-library/react";
import {
  useNotifications,
  shouldSuppressDuplicate,
  computeDismissDuration,
  DEDUPE_WINDOW_MS,
} from "@/hooks/useNotifications";

describe("shouldSuppressDuplicate (pure function)", () => {
  it("does not suppress non-error notifications", () => {
    const map = new Map<string, number>();
    expect(shouldSuppressDuplicate(map, "hello", "success", 1000)).toBe(false);
    expect(shouldSuppressDuplicate(map, "hello", "info", 1000)).toBe(false);
  });

  it("does not suppress first occurrence of error", () => {
    const map = new Map<string, number>();
    expect(shouldSuppressDuplicate(map, "Network error", "error", 1000)).toBe(false);
  });

  it("suppresses duplicate error within DEDUPE_WINDOW_MS", () => {
    const map = new Map<string, number>();
    shouldSuppressDuplicate(map, "Network error", "error", 1000);
    expect(shouldSuppressDuplicate(map, "Network error", "error", 1000 + DEDUPE_WINDOW_MS - 1)).toBe(true);
  });

  it("allows duplicate error after DEDUPE_WINDOW_MS has passed", () => {
    const map = new Map<string, number>();
    shouldSuppressDuplicate(map, "Network error", "error", 1000);
    expect(shouldSuppressDuplicate(map, "Network error", "error", 1000 + DEDUPE_WINDOW_MS)).toBe(false);
  });

  it("tracks different error texts independently", () => {
    const map = new Map<string, number>();
    shouldSuppressDuplicate(map, "Error A", "error", 1000);
    expect(shouldSuppressDuplicate(map, "Error B", "error", 1000)).toBe(false);
    expect(shouldSuppressDuplicate(map, "Error A", "error", 1001)).toBe(true);
  });

  it("updates timestamp when not suppressed", () => {
    const map = new Map<string, number>();
    shouldSuppressDuplicate(map, "err", "error", 1000);
    expect(map.get("err")).toBe(1000);
    // After window passes, timestamp updates
    shouldSuppressDuplicate(map, "err", "error", 1000 + DEDUPE_WINDOW_MS + 1);
    expect(map.get("err")).toBe(1000 + DEDUPE_WINDOW_MS + 1);
  });

  it("never suppresses success or info even if repeated", () => {
    const map = new Map<string, number>();
    for (let i = 0; i < 10; i++) {
      expect(shouldSuppressDuplicate(map, "same text", "success", 1000 + i)).toBe(false);
      expect(shouldSuppressDuplicate(map, "same text", "info", 1000 + i)).toBe(false);
    }
  });
});

describe("computeDismissDuration (pure function)", () => {
  it("returns 30000ms for error", () => {
    expect(computeDismissDuration("error")).toBe(30000);
  });

  it("returns 2500ms for success", () => {
    expect(computeDismissDuration("success")).toBe(2500);
  });

  it("returns 2500ms for info", () => {
    expect(computeDismissDuration("info")).toBe(2500);
  });
});

describe("useNotifications hook", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts with empty notifications", () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual([]);
  });

  it("adds a notification", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => result.current.addNotification("Hello", "success"));
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].text).toBe("Hello");
    expect(result.current.notifications[0].type).toBe("success");
  });

  it("assigns unique IDs to each notification", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.addNotification("A", "info");
      result.current.addNotification("B", "error");
    });
    const ids = result.current.notifications.map(n => n.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("auto-dismisses success after 2500ms", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => result.current.addNotification("Success", "success"));
    expect(result.current.notifications).toHaveLength(1);

    act(() => { jest.advanceTimersByTime(2499); });
    expect(result.current.notifications).toHaveLength(1);

    act(() => { jest.advanceTimersByTime(2); });
    expect(result.current.notifications).toHaveLength(0);
  });

  it("auto-dismisses error after 30000ms", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => result.current.addNotification("Error", "error"));
    expect(result.current.notifications).toHaveLength(1);

    act(() => { jest.advanceTimersByTime(29_999); });
    expect(result.current.notifications).toHaveLength(1);

    act(() => { jest.advanceTimersByTime(2); });
    expect(result.current.notifications).toHaveLength(0);
  });

  it("manually removes a notification by ID", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.addNotification("A", "info");
      result.current.addNotification("B", "info");
    });
    const idToRemove = result.current.notifications[0].id;
    act(() => result.current.removeNotification(idToRemove));
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].text).toBe("B");
  });

  it("removeNotification with non-existent ID does nothing", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => result.current.addNotification("A", "info"));
    act(() => result.current.removeNotification(99999));
    expect(result.current.notifications).toHaveLength(1);
  });

  it("handles multiple concurrent notifications with staggered auto-dismiss", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.addNotification("Info1", "info");     // dismiss at 2500
    });
    act(() => { jest.advanceTimersByTime(1000); });
    act(() => {
      result.current.addNotification("Error1", "error");   // dismiss at 1000+30000=31000
    });
    expect(result.current.notifications).toHaveLength(2);

    act(() => { jest.advanceTimersByTime(1501); }); // at 2501: info dismissed
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].text).toBe("Error1");

    act(() => { jest.advanceTimersByTime(28_500); }); // at 31001: error dismissed
    expect(result.current.notifications).toHaveLength(0);
  });

  it("suppresses duplicate error within dedup window", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.addNotification("Same error", "error");
      result.current.addNotification("Same error", "error");
    });
    // Second should be suppressed
    expect(result.current.notifications).toHaveLength(1);
  });

  it("does not suppress duplicate success notifications", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.addNotification("Saved!", "success");
      result.current.addNotification("Saved!", "success");
    });
    expect(result.current.notifications).toHaveLength(2);
  });

  it("cleans up timers on unmount", () => {
    const { result, unmount } = renderHook(() => useNotifications());
    act(() => result.current.addNotification("A", "info"));
    // Unmount should not throw
    expect(() => unmount()).not.toThrow();
    // Advancing timers after unmount should not throw
    act(() => { jest.advanceTimersByTime(10000); });
  });
});
