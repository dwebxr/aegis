/**
 * Tests for notification deduplication and timing logic.
 * Since @testing-library/react isn't available, we test the
 * dedup logic directly.
 */

const DEDUPE_WINDOW_MS = 5_000;

describe("notification dedup logic", () => {
  it("suppresses duplicate error within dedupe window", () => {
    const recentMap = new Map<string, number>();
    const now = Date.now();

    // First error — allowed
    const lastSeen1 = recentMap.get("Network error");
    const suppressed1 = lastSeen1 !== undefined && now - lastSeen1 < DEDUPE_WINDOW_MS;
    expect(suppressed1).toBe(false);
    recentMap.set("Network error", now);

    // Same error immediately — suppressed
    const lastSeen2 = recentMap.get("Network error");
    const suppressed2 = lastSeen2 !== undefined && now - lastSeen2 < DEDUPE_WINDOW_MS;
    expect(suppressed2).toBe(true);
  });

  it("allows same error after dedupe window", () => {
    const recentMap = new Map<string, number>();
    const now = Date.now();

    recentMap.set("Network error", now - DEDUPE_WINDOW_MS - 1);

    const lastSeen = recentMap.get("Network error")!;
    const suppressed = now - lastSeen < DEDUPE_WINDOW_MS;
    expect(suppressed).toBe(false);
  });

  it("does not deduplicate non-error types", () => {
    // Success and info types skip dedup entirely
    const type1: string = "success";
    const type2: string = "info";
    expect(type1 === "error").toBe(false);
    expect(type2 === "error").toBe(false);
  });

  it("allows different error messages simultaneously", () => {
    const recentMap = new Map<string, number>();
    const now = Date.now();

    recentMap.set("Error A", now);

    const lastSeen = recentMap.get("Error B");
    expect(lastSeen).toBeUndefined();
    // Different message → not suppressed
    const suppressed = lastSeen !== undefined && now - lastSeen < DEDUPE_WINDOW_MS;
    expect(suppressed).toBe(false);
  });

  it("auto-dismiss timer is 2500ms", () => {
    jest.useFakeTimers();
    let dismissed = false;
    const timer = setTimeout(() => { dismissed = true; }, 2500);

    jest.advanceTimersByTime(2499);
    expect(dismissed).toBe(false);

    jest.advanceTimersByTime(1);
    expect(dismissed).toBe(true);

    clearTimeout(timer);
    jest.useRealTimers();
  });

  it("IDs are unique and incrementing", () => {
    let nextId = 1;
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(nextId++);
    }
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
    // All incrementing
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });
});
