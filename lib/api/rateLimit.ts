import { NextRequest, NextResponse } from "next/server";
import { getKV, _resetKVCache } from "./kvStore";

// Re-export _resetKVCache for tests that already import it from rateLimit.
export { _resetKVCache };

// Sliding window via Vercel KV INCR+EXPIRE; falls back to in-memory rateLimit() when KV is absent.
export async function distributedRateLimit(
  request: NextRequest,
  limit = 20,
  windowSec = 60,
): Promise<NextResponse | null> {
  const store = await getKV();
  if (!store) return rateLimit(request, limit, windowSec * 1000);

  const ip = getClientIP(request);
  const windowKey = `aegis:rl:${ip}:${Math.floor(Date.now() / (windowSec * 1000))}`;

  const count = await store.incr(windowKey);
  if (count === 1) {
    await store.expire(windowKey, windowSec);
  }

  if (count > limit) {
    const ttl = await store.ttl(windowKey);
    const retryAfter = ttl > 0 ? ttl : windowSec;
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  return null;
}

// Caller-supplied bucket key (e.g. IC principal) caps independent traffic axes separately from per-IP.
export async function distributedRateLimitByKey(
  key: string,
  limit: number,
  windowSec: number,
  errorMessage = "Rate limit exceeded for this resource. Try again later.",
): Promise<NextResponse | null> {
  const store = await getKV();
  if (!store) return inMemoryRateLimitByKey(key, limit, windowSec * 1000, errorMessage);

  const windowKey = `aegis:rl:key:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const count = await store.incr(windowKey);
  if (count === 1) await store.expire(windowKey, windowSec);

  if (count > limit) {
    const ttl = await store.ttl(windowKey);
    const retryAfter = ttl > 0 ? ttl : windowSec;
    return NextResponse.json(
      { error: errorMessage },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  return null;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const MAX_WINDOW_ENTRIES = 10_000;
const windows = new Map<string, WindowEntry>();

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

function inMemoryRateLimitByKey(
  key: string,
  limit: number,
  windowMs: number,
  errorMessage: string,
): NextResponse | null {
  const bucketKey = `key:${key}`;
  const now = Date.now();
  const entry = windows.get(bucketKey);

  if (!entry || now >= entry.resetAt) {
    if (windows.size >= MAX_WINDOW_ENTRIES) {
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }
    windows.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (entry.count >= limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: errorMessage },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  entry.count++;
  return null;
}

// In-memory `rateLimit` is per-instance (Vercel warm-start state). Cold start = fresh Map.
// Burst protection only — distributed limits require KV (see distributedRateLimit above).
const DEFAULT_MAX_BODY = 512_000; // 512KB

export function checkBodySize(request: NextRequest, maxBytes = DEFAULT_MAX_BODY): NextResponse | null {
  const cl = request.headers.get("content-length");
  if (cl && parseInt(cl, 10) > maxBytes) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  return null;
}

// Parses JSON body with a 400 response on failure. For routes that compose their own rate-limit/body-size checks.
export async function parseJsonBody<T = Record<string, unknown>>(
  request: NextRequest,
): Promise<{ body: T; error?: undefined } | { body?: undefined; error: NextResponse }> {
  try {
    const body = await request.json() as T;
    return { body };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}

// Combined: rate limit → body size → JSON parse. Returns { body } or { error: NextResponse }.
export async function guardAndParse<T = Record<string, unknown>>(
  request: NextRequest,
  opts?: { limit?: number; windowMs?: number; maxBytes?: number },
): Promise<{ body: T; error?: undefined } | { body?: undefined; error: NextResponse }> {
  const limited = rateLimit(request, opts?.limit, opts?.windowMs);
  if (limited) return { error: limited };
  const tooLarge = checkBodySize(request, opts?.maxBytes);
  if (tooLarge) return { error: tooLarge };
  return parseJsonBody<T>(request);
}

// Same as guardAndParse but uses Vercel KV for distributed limits — windowSec
// (seconds) instead of windowMs to match distributedRateLimit's contract.
export async function distributedGuardAndParse<T = Record<string, unknown>>(
  request: NextRequest,
  opts?: { limit?: number; windowSec?: number; maxBytes?: number },
): Promise<{ body: T; error?: undefined } | { body?: undefined; error: NextResponse }> {
  const limited = await distributedRateLimit(request, opts?.limit, opts?.windowSec);
  if (limited) return { error: limited };
  const tooLarge = checkBodySize(request, opts?.maxBytes);
  if (tooLarge) return { error: tooLarge };
  return parseJsonBody<T>(request);
}

export function rateLimit(request: NextRequest, limit = 30, windowMs = 60_000): NextResponse | null {
  const ip = getClientIP(request);
  const now = Date.now();
  const entry = windows.get(ip);

  if (!entry || now >= entry.resetAt) {
    if (windows.size >= MAX_WINDOW_ENTRIES) {
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
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
