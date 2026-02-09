/**
 * Tests for /api/fetch/nostr route.
 * Tests input validation with the real handler (no mocking).
 */
import { POST } from "@/app/api/fetch/nostr/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/nostr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/nostr", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  describe("input validation", () => {
    it("returns 400 for missing relays", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("relay");
    });

    it("returns 400 for empty relays array", async () => {
      const res = await POST(makeRequest({ relays: [] }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-array relays", async () => {
      const res = await POST(makeRequest({ relays: "wss://relay.damus.io" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for relay without wss:// prefix", async () => {
      const res = await POST(makeRequest({ relays: ["relay.damus.io"] }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("wss://");
    });

    it("returns 400 for relay with ws:// prefix", async () => {
      const res = await POST(makeRequest({ relays: ["ws://relay.damus.io"] }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for relay with http:// prefix", async () => {
      const res = await POST(makeRequest({ relays: ["http://relay.damus.io"] }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string relay in array", async () => {
      const res = await POST(makeRequest({ relays: [123] }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for mixed valid and invalid relays", async () => {
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io", "http://bad.relay"],
      }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost:3000/api/fetch/nostr", {
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
