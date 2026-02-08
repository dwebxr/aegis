/**
 * Tests for /api/fetch/url route.
 * Tests input validation with the real handler (no mocking).
 * Extraction tests are skipped since they require network calls.
 */
import { POST } from "@/app/api/fetch/url/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/url", () => {
  describe("input validation", () => {
    it("returns 400 for missing url", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("required");
    });

    it("returns 400 for empty string url", async () => {
      const res = await POST(makeRequest({ url: "" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string url", async () => {
      const res = await POST(makeRequest({ url: 123 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid URL format", async () => {
      const res = await POST(makeRequest({ url: "not-a-url" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid URL");
    });

    it("returns 400 for ftp:// protocol", async () => {
      const res = await POST(makeRequest({ url: "ftp://files.example.com/doc.txt" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("HTTP or HTTPS");
    });

    it("returns 400 for file:// protocol", async () => {
      const res = await POST(makeRequest({ url: "file:///etc/passwd" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost:3000/api/fetch/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON");
    });
  });
});
