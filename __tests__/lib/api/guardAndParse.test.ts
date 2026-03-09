import { guardAndParse, checkBodySize, _resetRateLimits, distributedRateLimit, _resetKVCache, rateLimit } from "@/lib/api/rateLimit";
import { NextRequest } from "next/server";

function makeRequest(opts?: { ip?: string; body?: string; contentLength?: string }): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.ip) headers["x-forwarded-for"] = opts.ip;
  if (opts?.contentLength) headers["content-length"] = opts.contentLength;
  return new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers,
    body: opts?.body ?? JSON.stringify({ text: "hello" }),
  });
}

beforeEach(() => {
  _resetRateLimits();
});

describe("guardAndParse", () => {
  it("returns parsed body on success", async () => {
    const req = makeRequest({ ip: "10.0.0.1", body: JSON.stringify({ text: "test" }) });
    const result = await guardAndParse<{ text: string }>(req);
    expect(result.error).toBeUndefined();
    expect(result.body).toEqual({ text: "test" });
  });

  it("returns 429 error when rate limited", async () => {
    // Exhaust the rate limit
    for (let i = 0; i < 30; i++) {
      const req = makeRequest({ ip: "10.0.0.2" });
      rateLimit(req, 30, 60_000);
    }
    const req = makeRequest({ ip: "10.0.0.2" });
    const result = await guardAndParse(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(429);
    expect(result.body).toBeUndefined();
  });

  it("returns 413 error when body too large", async () => {
    const req = makeRequest({ ip: "10.0.0.3", contentLength: "999999999" });
    const result = await guardAndParse(req, { maxBytes: 1000 });
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(413);
  });

  it("returns 400 error for invalid JSON", async () => {
    const req = new NextRequest("http://localhost:3000/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.4" },
      body: "not{valid}json",
    });
    const result = await guardAndParse(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(400);
    const body = await result.error!.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("respects custom limit and windowMs options", async () => {
    for (let i = 0; i < 5; i++) {
      const req = makeRequest({ ip: "10.0.0.5" });
      rateLimit(req, 5, 60_000);
    }
    const req = makeRequest({ ip: "10.0.0.5" });
    const result = await guardAndParse(req, { limit: 5, windowMs: 60_000 });
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(429);
  });

  it("checks body size before JSON parse", async () => {
    const req = makeRequest({ ip: "10.0.0.6", contentLength: "2000000" });
    const result = await guardAndParse(req, { maxBytes: 1000 });
    // Should reject at size check, not reach JSON parse
    expect(result.error!.status).toBe(413);
  });
});

describe("checkBodySize", () => {
  it("returns null when content-length is absent or under limit", () => {
    const req = makeRequest({ ip: "10.0.0.7" });
    // NextRequest auto-sets content-length from body (16 bytes for '{"text":"hello"}')
    // checkBodySize returns null when content-length <= maxBytes or absent
    const result = checkBodySize(req, 100);
    expect(result).toBeNull();
  });

  it("returns null when content-length header is truly absent", () => {
    // Request with no body → no content-length header
    const req = new NextRequest("http://localhost:3000/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.7b" },
    });
    expect(checkBodySize(req, 100)).toBeNull();
  });

  it("returns null when content-length is under limit", () => {
    const req = makeRequest({ ip: "10.0.0.8", contentLength: "100" });
    expect(checkBodySize(req, 1000)).toBeNull();
  });

  it("returns 413 when content-length exceeds limit", () => {
    const req = makeRequest({ ip: "10.0.0.9", contentLength: "2000" });
    const result = checkBodySize(req, 1000);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(413);
  });

  it("returns null at exactly the limit", () => {
    const req = makeRequest({ ip: "10.0.0.10", contentLength: "1000" });
    expect(checkBodySize(req, 1000)).toBeNull();
  });

  it("returns 413 at limit+1", () => {
    const req = makeRequest({ ip: "10.0.0.11", contentLength: "1001" });
    expect(checkBodySize(req, 1000)).not.toBeNull();
  });

  it("uses default 512KB limit when not specified", () => {
    const req = makeRequest({ ip: "10.0.0.12", contentLength: "512000" });
    expect(checkBodySize(req)).toBeNull();

    const reqBig = makeRequest({ ip: "10.0.0.13", contentLength: "512001" });
    expect(checkBodySize(reqBig)).not.toBeNull();
  });
});

describe("rateLimit — MAX_WINDOW_ENTRIES eviction", () => {
  it("evicts oldest entry when map exceeds 10000 entries", () => {
    // Fill up with unique IPs (10000 limit)
    for (let i = 0; i < 10000; i++) {
      const req = makeRequest({ ip: `${Math.floor(i / 256)}.${i % 256}.0.1` });
      rateLimit(req, 1, 60_000);
    }

    // The 10001st unique IP should still be allowed (evicts oldest)
    const req = makeRequest({ ip: "255.255.255.255" });
    expect(rateLimit(req, 1, 60_000)).toBeNull();
  });
});

describe("distributedRateLimit", () => {
  beforeEach(() => {
    _resetRateLimits();
    _resetKVCache();
    delete process.env.KV_REST_API_URL;
  });

  it("falls back to in-memory rateLimit when KV unavailable", async () => {
    const req = makeRequest({ ip: "20.0.0.1" });
    const result = await distributedRateLimit(req, 30, 60);
    expect(result).toBeNull(); // First request should pass
  });

  it("blocks after exceeding limit with in-memory fallback", async () => {
    for (let i = 0; i < 3; i++) {
      const req = makeRequest({ ip: "20.0.0.2" });
      await distributedRateLimit(req, 3, 60);
    }
    const req = makeRequest({ ip: "20.0.0.2" });
    const result = await distributedRateLimit(req, 3, 60);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("converts windowSec to windowMs for in-memory fallback", async () => {
    const baseTime = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(baseTime);

    const req = makeRequest({ ip: "20.0.0.3" });
    rateLimit(req, 1, 10_000); // 10 second window

    jest.spyOn(Date, "now").mockReturnValue(baseTime + 10_001);
    const result = await distributedRateLimit(req, 1, 10);
    expect(result).toBeNull(); // Window expired

    jest.restoreAllMocks();
  });
});
