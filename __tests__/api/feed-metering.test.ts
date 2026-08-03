/**
 * The rate limiter must run before anything else in serveFeed.
 *
 * The missing-parameter 400 was briefly hoisted above it, on the theory that
 * the edge would absorb the repeats. Production disproved that — Vercel does
 * not store 400 responses (six consecutive 400s from one edge PoP all returned
 * x-vercel-cache: MISS while a 200 from the same PoP was HIT) — so hoisting
 * only removed the meter from a path that still costs a function invocation
 * per request. This pins the ordering so it cannot drift back.
 */
jest.mock("@dfinity/agent", () => ({
  HttpAgent: { create: jest.fn() },
  Actor: { createActor: jest.fn() },
}));

const mockDistributedRateLimit = jest.fn();
jest.mock("@/lib/api/rateLimit", () => ({
  ...jest.requireActual("@/lib/api/rateLimit"),
  distributedRateLimit: (...args: unknown[]) => mockDistributedRateLimit(...args),
}));

import { GET as RSS_GET } from "@/app/api/feed/rss/route";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "GET" });
}

beforeEach(() => {
  mockDistributedRateLimit.mockReset();
});

describe("serveFeed metering order", () => {
  it("meters a request that omits the principal", async () => {
    mockDistributedRateLimit.mockResolvedValue(
      NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 }),
    );

    const res = await RSS_GET(req("/api/feed/rss"));

    expect(mockDistributedRateLimit).toHaveBeenCalled();
    expect(res.status).toBe(429);
  });

  it("still answers 400 for a missing principal when under the limit", async () => {
    mockDistributedRateLimit.mockResolvedValue(null);

    const res = await RSS_GET(req("/api/feed/rss"));

    expect(res.status).toBe(400);
    // No cache directive: the CDN will not store a 400, so claiming one would
    // be a comment that is not true of the running system.
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});
