import { NextRequest, NextResponse } from "next/server";

// ─── KV-backed distributed rate limiter ──────────────────────────────

type KVStore = Awaited<typeof import("@vercel/kv")>["kv"];
let _kv: KVStore | null | undefined;

async function getKV(): Promise<KVStore | null> {
  if (_kv !== undefined) return _kv;
  if (!process.env.KV_REST_API_URL) {
    _kv = null;
    return null;
  }
  try {
    const mod = await import("@vercel/kv");
    _kv = mod.kv;
    return _kv;
  } catch {
    _kv = null;
    return null;
  }
}

/**
 * Distributed rate limiter using Vercel KV (Upstash Redis).
 * Uses sliding window via atomic INCR + EXPIRE.
 * Falls back to in-memory `rateLimit()` when KV is unavailable.
 */
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

export function _resetKVCache(): void {
  _kv = undefined;
}

// ─── In-memory rate limiter (per-instance) ───────────────────────────

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
const DEFAULT_MAX_BODY = 512_000; // 512KB

export function checkBodySize(request: NextRequest, maxBytes = DEFAULT_MAX_BODY): NextResponse | null {
  const cl = request.headers.get("content-length");
  if (cl && parseInt(cl, 10) > maxBytes) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  return null;
}

/**
 * Combined guard: rate limit + body size + JSON parse.
 * Returns { body } on success, or { error: NextResponse } on failure.
 */
export async function guardAndParse<T = Record<string, unknown>>(
  request: NextRequest,
  opts?: { limit?: number; windowMs?: number; maxBytes?: number },
): Promise<{ body: T; error?: undefined } | { body?: undefined; error: NextResponse }> {
  const limited = rateLimit(request, opts?.limit, opts?.windowMs);
  if (limited) return { error: limited };
  const tooLarge = checkBodySize(request, opts?.maxBytes);
  if (tooLarge) return { error: tooLarge };
  try {
    const body = await request.json() as T;
    return { body };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}

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
