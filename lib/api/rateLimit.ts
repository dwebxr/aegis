import { NextRequest, NextResponse } from "next/server";

interface WindowEntry {
  count: number;
  resetAt: number;
}

const MAX_WINDOW_ENTRIES = 10_000;
const windows = new Map<string, WindowEntry>();

// Cleanup stale entries to prevent unbounded memory growth
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
if (typeof setInterval !== "undefined") {
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    windows.forEach((entry, key) => {
      if (now >= entry.resetAt) windows.delete(key);
    });
  }, 60_000);
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) cleanupTimer.unref();
}

function getClientIP(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

export function _resetRateLimits(): void {
  windows.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Returns null if allowed, or 429 NextResponse if exceeded.
 *
 * LIMITATION: On Vercel serverless, state is per-instance (warm start).
 * Cold starts get a fresh Map. This provides burst protection within a
 * single instance but does not limit across distributed instances.
 * For stronger guarantees, migrate to Vercel KV or Redis.
 */
export function rateLimit(request: NextRequest, limit = 30, windowMs = 60_000): NextResponse | null {
  const ip = getClientIP(request);
  const now = Date.now();
  const entry = windows.get(ip);

  if (!entry || now >= entry.resetAt) {
    if (windows.size >= MAX_WINDOW_ENTRIES) {
      const oldest = windows.keys().next().value;
      if (oldest) windows.delete(oldest);
    }
    windows.set(ip, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (entry.count >= limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  entry.count++;
  return null;
}
