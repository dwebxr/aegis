/**
 * Tests for /api/fetch/twitter route.
 * Tests input validation with the real handler (no mocking).
 */
import { POST } from "@/app/api/fetch/twitter/route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/twitter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/twitter", () => {
  describe("input validation", () => {
    it("returns 400 for missing bearerToken", async () => {
      const res = await POST(makeRequest({ query: "test" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Bearer token");
    });

    it("returns 400 for empty bearerToken", async () => {
      const res = await POST(makeRequest({ bearerToken: "", query: "test" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for whitespace-only bearerToken", async () => {
      const res = await POST(makeRequest({ bearerToken: "   ", query: "test" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string bearerToken", async () => {
      const res = await POST(makeRequest({ bearerToken: 123, query: "test" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing query", async () => {
      const res = await POST(makeRequest({ bearerToken: "valid-token" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("query");
    });

    it("returns 400 for empty query", async () => {
      const res = await POST(makeRequest({ bearerToken: "valid-token", query: "" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for whitespace-only query", async () => {
      const res = await POST(makeRequest({ bearerToken: "valid-token", query: "   " }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string query", async () => {
      const res = await POST(makeRequest({ bearerToken: "valid-token", query: 42 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost:3000/api/fetch/twitter", {
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
