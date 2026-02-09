/**
 * Tests for /api/analyze rate limiting integration.
 * Verifies that the analyze endpoint enforces rate limits with real code paths.
 */
import { POST } from "@/app/api/analyze/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(text: string, ip = "10.0.0.1"): NextRequest {
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ text }),
  });
}

describe("POST /api/analyze — rate limiting", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  it("allows requests up to the limit (20 per minute)", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await POST(makeRequest(`Content number ${i}`));
      expect(res.status).toBe(200);
    }
  });

  it("blocks the 21st request with 429", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest(`Content ${i}`));
    }

    const blocked = await POST(makeRequest("One more request"));
    expect(blocked.status).toBe(429);

    const data = await blocked.json();
    expect(data.error).toContain("Rate limit");
  });

  it("includes Retry-After header in 429 response", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest(`Content ${i}`));
    }

    const blocked = await POST(makeRequest("Blocked"));
    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("tracks different IPs independently", async () => {
    // Exhaust limit for IP A
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest(`Content ${i}`, "192.168.1.1"));
    }
    const blockedA = await POST(makeRequest("Blocked A", "192.168.1.1"));
    expect(blockedA.status).toBe(429);

    // IP B should still be allowed
    const allowedB = await POST(makeRequest("Request from B", "192.168.1.2"));
    expect(allowedB.status).toBe(200);
  });

  it("allows requests again after window reset", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest(`Content ${i}`));
    }

    // Blocked
    const blocked = await POST(makeRequest("Blocked"));
    expect(blocked.status).toBe(429);

    // Reset (simulates window expiry)
    _resetRateLimits();

    // Allowed again
    const allowed = await POST(makeRequest("Allowed again"));
    expect(allowed.status).toBe(200);
  });
});
