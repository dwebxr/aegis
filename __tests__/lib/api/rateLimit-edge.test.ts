/**
 * Edge case tests for lib/api/rateLimit.ts
 * Tests window expiry, IP header parsing, boundary conditions.
 */
import { rateLimit, _resetRateLimits } from "@/lib/api/rateLimit";
import { NextRequest } from "next/server";

function makeRequest(headers?: Record<string, string>): NextRequest {
  const h: Record<string, string> = { "Content-Type": "application/json", ...headers };
  return new NextRequest("http://localhost:3000/api/test", { method: "POST", headers: h });
}

describe("rateLimit — edge cases", () => {
  beforeEach(() => {
    _resetRateLimits();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("IP header parsing", () => {
    it("extracts first IP from x-forwarded-for with multiple IPs", () => {
      const req1 = makeRequest({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" });
      // Use up the limit for IP 1.1.1.1
      for (let i = 0; i < 3; i++) {
        rateLimit(req1, 3, 60_000);
      }
      expect(rateLimit(req1, 3, 60_000)).not.toBeNull();

      // Different first IP should not be limited
      const req2 = makeRequest({ "x-forwarded-for": "4.4.4.4, 1.1.1.1" });
      expect(rateLimit(req2, 3, 60_000)).toBeNull();
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", () => {
      const req1 = makeRequest({ "x-real-ip": "5.5.5.5" });
      for (let i = 0; i < 2; i++) {
        rateLimit(req1, 2, 60_000);
      }
      expect(rateLimit(req1, 2, 60_000)).not.toBeNull();

      // Different x-real-ip should not be limited
      const req2 = makeRequest({ "x-real-ip": "6.6.6.6" });
      expect(rateLimit(req2, 2, 60_000)).toBeNull();
    });

    it("uses 'unknown' when no IP headers present", () => {
      const req = makeRequest();
      for (let i = 0; i < 2; i++) {
        rateLimit(req, 2, 60_000);
      }
      // Both use 'unknown' so should be rate limited
      expect(rateLimit(req, 2, 60_000)).not.toBeNull();
    });

    it("trims whitespace from x-forwarded-for IPs", () => {
      const req1 = makeRequest({ "x-forwarded-for": "  1.1.1.1  , 2.2.2.2" });
      const req2 = makeRequest({ "x-forwarded-for": "1.1.1.1" });
      // Both should map to same IP
      for (let i = 0; i < 2; i++) {
        rateLimit(req1, 2, 60_000);
      }
      expect(rateLimit(req2, 2, 60_000)).not.toBeNull();
    });
  });

  describe("window expiry", () => {
    it("resets window after windowMs expires", () => {
      const baseTime = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockReturnValue(baseTime);

      const req = makeRequest({ "x-forwarded-for": "7.7.7.7" });
      for (let i = 0; i < 3; i++) {
        rateLimit(req, 3, 5_000);
      }
      expect(rateLimit(req, 3, 5_000)).not.toBeNull();

      // Advance past window
      jest.spyOn(Date, "now").mockReturnValue(baseTime + 5_001);
      expect(rateLimit(req, 3, 5_000)).toBeNull();
    });

    it("does not reset window before expiry", () => {
      const baseTime = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockReturnValue(baseTime);

      const req = makeRequest({ "x-forwarded-for": "8.8.8.8" });
      for (let i = 0; i < 3; i++) {
        rateLimit(req, 3, 10_000);
      }

      jest.spyOn(Date, "now").mockReturnValue(baseTime + 9_999);
      expect(rateLimit(req, 3, 10_000)).not.toBeNull();
    });
  });

  describe("boundary conditions", () => {
    it("allows exactly limit requests, blocks limit+1", () => {
      const req = makeRequest({ "x-forwarded-for": "9.9.9.9" });
      for (let i = 0; i < 30; i++) {
        expect(rateLimit(req, 30, 60_000)).toBeNull();
      }
      const blocked = rateLimit(req, 30, 60_000);
      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
    });

    it("limit of 1 allows single request then blocks", () => {
      const req = makeRequest({ "x-forwarded-for": "10.10.10.10" });
      expect(rateLimit(req, 1, 60_000)).toBeNull();
      expect(rateLimit(req, 1, 60_000)).not.toBeNull();
    });

    it("Retry-After header reflects remaining window time", async () => {
      const baseTime = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockReturnValue(baseTime);

      const req = makeRequest({ "x-forwarded-for": "11.11.11.11" });
      rateLimit(req, 1, 30_000);

      // 10 seconds later
      jest.spyOn(Date, "now").mockReturnValue(baseTime + 10_000);
      const blocked = rateLimit(req, 1, 30_000);
      expect(blocked).not.toBeNull();
      const retryAfter = Number(blocked!.headers.get("Retry-After"));
      expect(retryAfter).toBe(20); // 30s window - 10s elapsed = 20s
    });
  });

  describe("concurrent IPs", () => {
    it("tracks 100 different IPs independently", () => {
      for (let i = 0; i < 100; i++) {
        const req = makeRequest({ "x-forwarded-for": `${i}.0.0.1` });
        rateLimit(req, 1, 60_000);
      }
      // Each IP used 1 of 1, so 101st request from IP 0 should be blocked
      const req0 = makeRequest({ "x-forwarded-for": "0.0.0.1" });
      expect(rateLimit(req0, 1, 60_000)).not.toBeNull();

      // IP 200 never seen, should be allowed
      const reqNew = makeRequest({ "x-forwarded-for": "200.0.0.1" });
      expect(rateLimit(reqNew, 1, 60_000)).toBeNull();
    });
  });
});
