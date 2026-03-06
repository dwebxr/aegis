import { NextRequest } from "next/server";

// Mock KV store
let kvStore: Record<string, number> = {};
let kvTtls: Record<string, number> = {};

jest.mock("@vercel/kv", () => ({
  kv: {
    incr: jest.fn(async (key: string) => {
      kvStore[key] = (kvStore[key] ?? 0) + 1;
      return kvStore[key];
    }),
    expire: jest.fn(async (key: string, ttl: number) => {
      kvTtls[key] = ttl;
    }),
    ttl: jest.fn(async (key: string) => kvTtls[key] ?? -1),
  },
}));

const originalEnv = process.env.KV_REST_API_URL;

import {
  distributedRateLimit,
  rateLimit,
  _resetRateLimits,
  _resetKVCache,
} from "@/lib/api/rateLimit";

function makeRequest(ip: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  _resetRateLimits();
  _resetKVCache();
  kvStore = {};
  kvTtls = {};
  jest.clearAllMocks();
});

afterAll(() => {
  if (originalEnv) {
    process.env.KV_REST_API_URL = originalEnv;
  } else {
    delete process.env.KV_REST_API_URL;
  }
});

describe("distributedRateLimit — with KV", () => {
  beforeEach(() => {
    process.env.KV_REST_API_URL = "https://fake-kv.upstash.io";
    _resetKVCache();
  });

  afterEach(() => {
    delete process.env.KV_REST_API_URL;
  });

  it("allows requests under the limit", async () => {
    const req = makeRequest("1.2.3.4");
    for (let i = 0; i < 5; i++) {
      const result = await distributedRateLimit(req, 5, 60);
      expect(result).toBeNull();
    }
  });

  it("blocks requests exceeding the limit", async () => {
    const req = makeRequest("1.2.3.4");
    for (let i = 0; i < 3; i++) {
      await distributedRateLimit(req, 3, 60);
    }
    const blocked = await distributedRateLimit(req, 3, 60);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);

    const body = await blocked!.json();
    expect(body.error).toContain("Rate limit");
  });

  it("returns Retry-After header", async () => {
    const req = makeRequest("2.2.2.2");
    await distributedRateLimit(req, 1, 60);
    const blocked = await distributedRateLimit(req, 1, 60);
    expect(blocked).not.toBeNull();
    const retryAfter = blocked!.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("sets TTL on first request via expire", async () => {
    const { kv } = require("@vercel/kv");
    const req = makeRequest("3.3.3.3");
    await distributedRateLimit(req, 10, 60);

    expect(kv.incr).toHaveBeenCalledTimes(1);
    expect(kv.expire).toHaveBeenCalledTimes(1);
    const expireArgs = kv.expire.mock.calls[0];
    expect(expireArgs[1]).toBe(60);
  });

  it("does not re-set TTL on subsequent requests", async () => {
    const { kv } = require("@vercel/kv");
    const req = makeRequest("4.4.4.4");
    await distributedRateLimit(req, 10, 60);
    await distributedRateLimit(req, 10, 60);

    // expire called only once (on count === 1)
    expect(kv.expire).toHaveBeenCalledTimes(1);
    expect(kv.incr).toHaveBeenCalledTimes(2);
  });

  it("tracks different IPs independently", async () => {
    const req1 = makeRequest("5.5.5.5");
    const req2 = makeRequest("6.6.6.6");

    await distributedRateLimit(req1, 1, 60);
    const blocked = await distributedRateLimit(req1, 1, 60);
    expect(blocked).not.toBeNull();

    const allowed = await distributedRateLimit(req2, 1, 60);
    expect(allowed).toBeNull();
  });
});

describe("distributedRateLimit — without KV (fallback)", () => {
  beforeEach(() => {
    delete process.env.KV_REST_API_URL;
    _resetKVCache();
  });

  it("falls back to in-memory rateLimit", async () => {
    const req = makeRequest("7.7.7.7");
    for (let i = 0; i < 3; i++) {
      const result = await distributedRateLimit(req, 3, 60);
      expect(result).toBeNull();
    }
    const blocked = await distributedRateLimit(req, 3, 60);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });

  it("does not call KV methods", async () => {
    const { kv } = require("@vercel/kv");
    const req = makeRequest("8.8.8.8");
    await distributedRateLimit(req, 10, 60);
    expect(kv.incr).not.toHaveBeenCalled();
  });
});
