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

describe("POST /api/fetch/rss", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  describe("input validation", () => {
    it("returns 400 for missing feedUrl", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("required");
    });

    it("returns 400 for empty string feedUrl", async () => {
      const res = await POST(makeRequest({ feedUrl: "" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string feedUrl", async () => {
      const res = await POST(makeRequest({ feedUrl: 42 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid URL format", async () => {
      const res = await POST(makeRequest({ feedUrl: "not a url" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid URL");
    });

    it("blocks localhost (SSRF)", async () => {
      const res = await POST(makeRequest({ feedUrl: "http://127.0.0.1/feed.xml" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Localhost");
    });

    it("blocks private IPs (SSRF)", async () => {
      const res = await POST(makeRequest({ feedUrl: "http://192.168.1.1/feed" }));
      expect(res.status).toBe(400);
    });

    it("blocks cloud metadata endpoint (SSRF)", async () => {
      const res = await POST(makeRequest({ feedUrl: "http://169.254.169.254/latest/" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost:3000/api/fetch/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{broken",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON");
    });

    it("defaults limit to 20 when not provided", async () => {
      // Verify limit is optional (route doesn't 400 when limit missing).
      // Use non-routable TLD for fast DNS failure to avoid open socket leak.
      const res = await POST(makeRequest({ feedUrl: "https://nonexistent.invalid/feed.xml" }));
      // Will fail with network error (502), not 400
      expect(res.status).not.toBe(400);
    });
  });
});
