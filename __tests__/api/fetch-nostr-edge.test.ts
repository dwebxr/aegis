import { POST } from "@/app/api/fetch/nostr/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

// Mock nostr-tools/pool to avoid real relay connections
const mockQuerySync = jest.fn().mockResolvedValue([]);
const mockClose = jest.fn();
jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: mockQuerySync,
    close: mockClose,
  })),
  useWebSocketImplementation: jest.fn(),
}));

// Mock ws — route imports it for server-side WebSocket
jest.mock("ws", () => ({ default: jest.fn(), __esModule: true }));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/nostr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/nostr — edge cases", () => {
  beforeEach(() => {
    _resetRateLimits();
    mockQuerySync.mockClear();
    mockClose.mockClear();
    mockQuerySync.mockResolvedValue([]);
  });

  describe("filter construction", () => {
    it("accepts optional pubkeys array", async () => {
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io"],
        pubkeys: ["abc123def456"],
        limit: 5,
      }));
      expect(res.status).toBe(200);
      expect(mockQuerySync).toHaveBeenCalledWith(
        ["wss://relay.damus.io"],
        expect.objectContaining({ authors: ["abc123def456"], limit: 5 }),
      );
    });

    it("accepts optional hashtags array", async () => {
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io"],
        hashtags: ["nostr", "bitcoin"],
        limit: 5,
      }));
      expect(res.status).toBe(200);
      expect(mockQuerySync).toHaveBeenCalledWith(
        ["wss://relay.damus.io"],
        expect.objectContaining({ "#t": ["nostr", "bitcoin"], limit: 5 }),
      );
    });

    it("accepts optional since parameter", async () => {
      const since = Math.floor(Date.now() / 1000) - 3600;
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io"],
        since,
        limit: 5,
      }));
      expect(res.status).toBe(200);
      expect(mockQuerySync).toHaveBeenCalledWith(
        ["wss://relay.damus.io"],
        expect.objectContaining({ since, limit: 5 }),
      );
    });

    it("clamps limit to max 100", async () => {
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io"],
        limit: 999,
      }));
      expect(res.status).toBe(200);
      expect(mockQuerySync).toHaveBeenCalledWith(
        ["wss://relay.damus.io"],
        expect.objectContaining({ limit: 100 }),
      );
    });

    it("accepts valid relay with path", async () => {
      const res = await POST(makeRequest({
        relays: ["wss://relay.example.com/nostr"],
        limit: 1,
      }));
      expect(res.status).toBe(200);
    });
  });

  describe("multiple relay validation", () => {
    it("blocks if any relay is private (first relay)", async () => {
      const res = await POST(makeRequest({
        relays: ["wss://10.0.0.1", "wss://relay.damus.io"],
      }));
      expect(res.status).toBe(400);
    });

    it("blocks if any relay is private (last relay)", async () => {
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io", "wss://192.168.0.1"],
      }));
      expect(res.status).toBe(400);
    });
  });

  describe("default limit", () => {
    it("defaults limit to 20 when not provided", async () => {
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io"],
      }));
      expect(res.status).toBe(200);
      expect(mockQuerySync).toHaveBeenCalledWith(
        ["wss://relay.damus.io"],
        expect.objectContaining({ limit: 20 }),
      );
    });
  });

  describe("response mapping", () => {
    it("returns events with profiles when relay returns data", async () => {
      mockQuerySync
        .mockResolvedValueOnce([
          { id: "e1", pubkey: "pk1", content: "hello", created_at: 1000, tags: [] },
        ])
        .mockResolvedValueOnce([
          { pubkey: "pk1", content: JSON.stringify({ name: "Alice" }), kind: 0 },
        ]);
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io"],
        limit: 5,
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.events).toHaveLength(1);
      expect(data.events[0]).toEqual({
        id: "e1", pubkey: "pk1", content: "hello", createdAt: 1000, tags: [],
      });
      expect(data.profiles.pk1).toEqual({ name: "Alice", picture: undefined });
    });

    it("returns timeout warning when relay query times out", async () => {
      mockQuerySync.mockRejectedValueOnce(new Error("timeout"));
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io"],
        limit: 5,
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.events).toEqual([]);
      expect(data.warning).toContain("timed out");
    });

    it("returns 502 on non-timeout relay error", async () => {
      mockQuerySync.mockRejectedValueOnce(new Error("Connection refused"));
      const res = await POST(makeRequest({
        relays: ["wss://relay.damus.io"],
        limit: 5,
      }));
      expect(res.status).toBe(502);
    });
  });

  describe("cleanup", () => {
    it("calls pool.close with relays after successful query", async () => {
      await POST(makeRequest({ relays: ["wss://relay.damus.io"], limit: 1 }));
      expect(mockClose).toHaveBeenCalledWith(["wss://relay.damus.io"]);
    });

    it("calls pool.close with relays after failed query", async () => {
      mockQuerySync.mockRejectedValueOnce(new Error("fail"));
      await POST(makeRequest({ relays: ["wss://relay.damus.io"], limit: 1 }));
      expect(mockClose).toHaveBeenCalledWith(["wss://relay.damus.io"]);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after exceeding limit with invalid inputs (fast path)", async () => {
      for (let i = 0; i < 30; i++) {
        await POST(makeRequest({ relays: [] }));
      }
      const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
      expect(res.status).toBe(429);
    });
  });
});
