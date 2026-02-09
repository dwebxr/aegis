import { NextRequest, NextResponse } from "next/server";

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

// Cleanup stale entries every 60 seconds to prevent unbounded memory growth
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const now = Date.now();
    windows.forEach((entry, key) => {
      if (now >= entry.resetAt) windows.delete(key);
    });
  }, 60_000);
  // Allow Node.js process to exit even if this timer is active (prevents test hangs)
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

function getClientIP(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

/** Clear all rate limit windows (for testing only). */
export function _resetRateLimits(): void {
  windows.clear();
}

/**
 * Check rate limit for a request. Returns null if allowed, or a 429 NextResponse if exceeded.
 * @param request - The incoming request
 * @param limit - Max requests per window (default: 30)
 * @param windowMs - Window duration in ms (default: 60_000 = 1 minute)
 */
export function rateLimit(request: NextRequest, limit = 30, windowMs = 60_000): NextResponse | null {
  const ip = getClientIP(request);
  const now = Date.now();
  const entry = windows.get(ip);

  if (!entry || now >= entry.resetAt) {
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
