import { rateLimit, _resetRateLimits } from "@/lib/api/rateLimit";
import { NextRequest } from "next/server";

function makeRequest(ip?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ip) headers["x-forwarded-for"] = ip;
  return new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers,
  });
}

describe("rateLimit", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  it("allows requests under the limit", () => {
    const req = makeRequest("1.2.3.4");
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(req, 5, 60_000)).toBeNull();
    }
  });

  it("blocks requests exceeding the limit", () => {
    const req = makeRequest("1.2.3.4");
    for (let i = 0; i < 5; i++) {
      rateLimit(req, 5, 60_000);
    }
    const blocked = rateLimit(req, 5, 60_000);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });

  it("returns Retry-After header when blocked", async () => {
    const req = makeRequest("1.2.3.4");
    for (let i = 0; i < 3; i++) {
      rateLimit(req, 3, 60_000);
    }
    const blocked = rateLimit(req, 3, 60_000);
    expect(blocked).not.toBeNull();
    const retryAfter = blocked!.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
    const body = await blocked!.json();
    expect(body.error).toContain("Rate limit");
  });

  it("tracks different IPs independently", () => {
    const req1 = makeRequest("1.1.1.1");
    const req2 = makeRequest("2.2.2.2");
    for (let i = 0; i < 3; i++) {
      rateLimit(req1, 3, 60_000);
    }
    // IP 1 is blocked
    expect(rateLimit(req1, 3, 60_000)).not.toBeNull();
    // IP 2 is still allowed
    expect(rateLimit(req2, 3, 60_000)).toBeNull();
  });

  it("uses 'unknown' for requests without IP headers", () => {
    const req = makeRequest(); // no IP header
    for (let i = 0; i < 2; i++) {
      rateLimit(req, 2, 60_000);
    }
    expect(rateLimit(req, 2, 60_000)).not.toBeNull();
  });

  it("resets after _resetRateLimits", () => {
    const req = makeRequest("1.2.3.4");
    for (let i = 0; i < 3; i++) {
      rateLimit(req, 3, 60_000);
    }
    expect(rateLimit(req, 3, 60_000)).not.toBeNull();
    _resetRateLimits();
    expect(rateLimit(req, 3, 60_000)).toBeNull();
  });
});
