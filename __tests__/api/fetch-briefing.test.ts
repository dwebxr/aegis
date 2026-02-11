/**
 * Tests for /api/fetch/briefing route.
 * Tests input validation for GET endpoint with naddr parameter.
 * Mocks nostr-tools and ws to avoid real relay connections.
 */
jest.mock("nostr-tools/nip19", () => ({
  decode: jest.fn(),
}));

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: jest.fn().mockResolvedValue([]),
    close: jest.fn(),
  })),
  useWebSocketImplementation: jest.fn(),
}));

jest.mock("ws", () => ({
  default: jest.fn(),
}));

import { GET } from "@/app/api/fetch/briefing/route";
import { NextRequest } from "next/server";
import { decode } from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";

const mockDecode = decode as jest.MockedFunction<typeof decode>;

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/fetch/briefing");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/fetch/briefing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("input validation", () => {
    it("returns 400 when naddr parameter is missing", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("naddr");
    });

    it("returns 400 when naddr decode fails", async () => {
      mockDecode.mockImplementation(() => { throw new Error("Invalid bech32"); });

      const res = await GET(makeRequest({ naddr: "invalid-naddr" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("decode");
    });

    it("returns 400 when decoded type is not naddr", async () => {
      mockDecode.mockReturnValue({ type: "npub", data: "abc123" } as ReturnType<typeof decode>);

      const res = await GET(makeRequest({ naddr: "npub1abc123" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid naddr");
    });

    it("returns 400 when kind is not long-form (30023)", async () => {
      mockDecode.mockReturnValue({
        type: "naddr",
        data: { kind: 1, pubkey: "abc", identifier: "test", relays: [] },
      } as ReturnType<typeof decode>);

      const res = await GET(makeRequest({ naddr: "naddr1test" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("long-form");
    });
  });

  describe("relay query", () => {
    it("returns 404 when no events found on relays", async () => {
      mockDecode.mockReturnValue({
        type: "naddr",
        data: { kind: 30023, pubkey: "abc123", identifier: "briefing-123", relays: [] },
      } as ReturnType<typeof decode>);

      const mockPool = { querySync: jest.fn().mockResolvedValue([]), close: jest.fn() };
      (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => mockPool as unknown as SimplePool);

      const res = await GET(makeRequest({ naddr: "naddr1valid" }));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns event data when found on relay", async () => {
      mockDecode.mockReturnValue({
        type: "naddr",
        data: { kind: 30023, pubkey: "pub123", identifier: "briefing-1700000000000", relays: ["wss://relay.damus.io"] },
      } as ReturnType<typeof decode>);

      const mockEvent = {
        content: "# Test Briefing\n\nContent here",
        tags: [["title", "Test Briefing"], ["published_at", "1700000000"]],
        pubkey: "pub123",
        created_at: 1700000000,
      };
      const mockPool = {
        querySync: jest.fn().mockResolvedValue([mockEvent]),
        close: jest.fn(),
      };
      (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => mockPool as unknown as SimplePool);

      const res = await GET(makeRequest({ naddr: "naddr1valid" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).toBe("# Test Briefing\n\nContent here");
      expect(data.pubkey).toBe("pub123");
      expect(data.tags).toBeDefined();
      expect(data.created_at).toBe(1700000000);
    });

    it("returns 502 when relay query throws", async () => {
      mockDecode.mockReturnValue({
        type: "naddr",
        data: { kind: 30023, pubkey: "abc", identifier: "test", relays: [] },
      } as ReturnType<typeof decode>);

      const mockPool = {
        querySync: jest.fn().mockRejectedValue(new Error("Connection failed")),
        close: jest.fn(),
      };
      (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => mockPool as unknown as SimplePool);

      const res = await GET(makeRequest({ naddr: "naddr1valid" }));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("Relay query failed");
    });

    it("closes pool after successful query", async () => {
      mockDecode.mockReturnValue({
        type: "naddr",
        data: { kind: 30023, pubkey: "abc", identifier: "test", relays: [] },
      } as ReturnType<typeof decode>);

      const mockClose = jest.fn();
      const mockPool = {
        querySync: jest.fn().mockResolvedValue([]),
        close: mockClose,
      };
      (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => mockPool as unknown as SimplePool);

      await GET(makeRequest({ naddr: "naddr1valid" }));
      expect(mockClose).toHaveBeenCalled();
    });

    it("closes pool even after query error", async () => {
      mockDecode.mockReturnValue({
        type: "naddr",
        data: { kind: 30023, pubkey: "abc", identifier: "test", relays: [] },
      } as ReturnType<typeof decode>);

      const mockClose = jest.fn();
      const mockPool = {
        querySync: jest.fn().mockRejectedValue(new Error("fail")),
        close: mockClose,
      };
      (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => mockPool as unknown as SimplePool);

      await GET(makeRequest({ naddr: "naddr1valid" }));
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
