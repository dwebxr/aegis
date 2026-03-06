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
import { _resetRateLimits } from "@/lib/api/rateLimit";

const mockDecode = decode as jest.MockedFunction<typeof decode>;

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/fetch/briefing");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET", headers: { "x-forwarded-for": "99.99.99.99" } });
}

describe("GET /api/fetch/briefing — edge cases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRateLimits();
  });

  it("returns 400 when naddr exceeds 1000 characters", async () => {
    const longNaddr = "a".repeat(1001);
    const res = await GET(makeRequest({ naddr: longNaddr }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("too long");
  });

  it("allows naddr at exactly 1000 characters (decode will fail but not length check)", async () => {
    const exactNaddr = "a".repeat(1000);
    mockDecode.mockImplementation(() => { throw new Error("bad bech32"); });
    const res = await GET(makeRequest({ naddr: exactNaddr }));
    // Should get past length check, fail at decode
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("decode");
  });

  it("returns 504 when relay query times out", async () => {
    mockDecode.mockReturnValue({
      type: "naddr",
      data: { kind: 30023, pubkey: "abc", identifier: "test", relays: [] },
    } as ReturnType<typeof decode>);

    const mockPool = {
      querySync: jest.fn().mockRejectedValue(new Error("timeout")),
      close: jest.fn(),
    };
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => mockPool as unknown as SimplePool);

    const res = await GET(makeRequest({ naddr: "naddr1valid" }));
    expect(res.status).toBe(504);
    const data = await res.json();
    expect(data.error).toContain("timed out");
  });

  it("returns 502 for non-timeout relay errors", async () => {
    mockDecode.mockReturnValue({
      type: "naddr",
      data: { kind: 30023, pubkey: "abc", identifier: "test", relays: [] },
    } as ReturnType<typeof decode>);

    const mockPool = {
      querySync: jest.fn().mockRejectedValue(new Error("Connection refused")),
      close: jest.fn(),
    };
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => mockPool as unknown as SimplePool);

    const res = await GET(makeRequest({ naddr: "naddr1valid" }));
    expect(res.status).toBe(502);
  });
});
