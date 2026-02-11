import { POST } from "@/app/api/fetch/rss/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/rss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/rss — edge cases", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  describe("SSRF protection", () => {
    it("blocks localhost feed URL", async () => {
      const res = await POST(makeRequest({ feedUrl: "http://localhost/feed" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Localhost");
    });

    it("blocks 127.0.0.1 feed URL", async () => {
      const res = await POST(makeRequest({ feedUrl: "http://127.0.0.1/rss" }));
      expect(res.status).toBe(400);
    });

    it("blocks internal network IPs", async () => {
      const res = await POST(makeRequest({ feedUrl: "http://10.0.0.1/feed" }));
      expect(res.status).toBe(400);
    });

    it("blocks cloud metadata endpoint", async () => {
      const res = await POST(makeRequest({ feedUrl: "http://169.254.169.254/latest/meta-data/" }));
      expect(res.status).toBe(400);
    });

    it("blocks non-HTTP protocols", async () => {
      const res = await POST(makeRequest({ feedUrl: "ftp://example.com/feed" }));
      expect(res.status).toBe(400);
    });
  });

  describe("input validation", () => {
    it("returns 400 for missing feedUrl", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("required");
    });

    it("returns 400 for empty feedUrl", async () => {
      const res = await POST(makeRequest({ feedUrl: "" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string feedUrl", async () => {
      const res = await POST(makeRequest({ feedUrl: 42 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost:3000/api/fetch/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("limit parameter", () => {
    it("clamps limit to maximum 50", async () => {
      // We can't easily verify the clamp without a real feed,
      // but at least verify the route accepts the param
      const res = await POST(makeRequest({ feedUrl: "https://nonexistent.example.com/feed", limit: 200 }));
      // Will fail on fetch (502) but not on validation
      expect(res.status).not.toBe(400);
    });
  });
});
