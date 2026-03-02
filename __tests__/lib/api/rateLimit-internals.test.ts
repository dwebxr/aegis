import { NextRequest } from "next/server";

function makeRequest(ip: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimit — cleanup timer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("cleanup interval removes expired entries without error", () => {
    jest.setSystemTime(1_700_000_000_000);

    // Use isolateModules to load the module with fake timers active
    // so setInterval is captured by jest's fake timer
    let rl: (req: NextRequest, limit?: number, windowMs?: number) => ReturnType<typeof import("@/lib/api/rateLimit").rateLimit>;
    let reset: () => void;

    jest.isolateModules(() => {
      const mod = require("@/lib/api/rateLimit");
      rl = mod.rateLimit;
      reset = mod._resetRateLimits;
    });

    // Create an entry with short window (5s)
    rl!(makeRequest("timer-test-ip"), 10, 5_000);

    // Also create an entry that's still active (long window)
    rl!(makeRequest("timer-active-ip"), 10, 120_000);

    // Move time past the short window's expiry
    jest.setSystemTime(1_700_000_010_000);

    // Advance to fire the 60-second cleanup interval
    jest.advanceTimersByTime(60_000);

    // The expired entry (timer-test-ip) should have been cleaned up
    // Verify by making a request from that IP — should get fresh window (allowed)
    const result = rl!(makeRequest("timer-test-ip"), 1, 5_000);
    expect(result).toBeNull(); // allowed = entry was cleaned up and recreated

    // Active entry (timer-active-ip) should still exist with its count
    // It was created at t=1_700_000_000_000 with 120s window, so resetAt = t+120_000
    // Current time is t+10s, so it's still active
    rl!(makeRequest("timer-active-ip"), 10, 120_000); // count incremented to 2
    // Should still be allowed (only 2 of 10)
    expect(rl!(makeRequest("timer-active-ip"), 10, 120_000)).toBeNull();

    reset!();
  });
});

describe("rateLimit — MAX_WINDOW_ENTRIES eviction", () => {
  it("evicts oldest entry when map reaches 10,000 entries", () => {
    let rl: (req: NextRequest, limit?: number, windowMs?: number) => ReturnType<typeof import("@/lib/api/rateLimit").rateLimit>;
    let reset: () => void;

    jest.isolateModules(() => {
      const mod = require("@/lib/api/rateLimit");
      rl = mod.rateLimit;
      reset = mod._resetRateLimits;
    });

    // Use limit=1 so the first request exhausts the quota.
    // If not evicted, next request from same IP returns 429.
    // If evicted, IP gets a fresh window and returns null.

    // Fill map with 10,000 unique IPs (each at count=1, limit=1 → exhausted)
    for (let i = 0; i < 10_000; i++) {
      const a = (i >> 16) & 255;
      const b = (i >> 8) & 255;
      const c = i & 255;
      rl!(makeRequest(`${a}.${b}.${c}.1`), 1, 300_000);
    }

    // Sanity: 0.0.0.1 is rate-limited (count=1 >= limit=1)
    const beforeEviction = rl!(makeRequest("0.0.0.1"), 1, 300_000);
    expect(beforeEviction).not.toBeNull();
    expect(beforeEviction!.status).toBe(429);

    // Add one more to trigger eviction of oldest (0.0.0.1)
    rl!(makeRequest("evict-trigger"), 1, 300_000);

    // 0.0.0.1 was evicted → gets fresh window → allowed
    const afterEviction = rl!(makeRequest("0.0.0.1"), 1, 300_000);
    expect(afterEviction).toBeNull();

    reset!();
  }, 30_000);
});
