const mockQuerySync = jest.fn();
const mockClose = jest.fn();

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: mockQuerySync,
    close: mockClose,
  })),
  useWebSocketImplementation: jest.fn(),
}));

jest.mock("ws", () => ({
  default: jest.fn(),
}));

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

describe("POST /api/fetch/nostr — mocked relay", () => {
  beforeEach(() => {
    mockQuerySync.mockReset();
    mockClose.mockReset();
    _resetRateLimits();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("returns events from relay query", async () => {
    mockQuerySync
      .mockResolvedValueOnce([
        { id: "evt1", pubkey: "pub1", content: "hello", created_at: 1700000010, tags: [] },
        { id: "evt2", pubkey: "pub2", content: "world", created_at: 1700000000, tags: [["t", "nostr"]] },
      ])
      .mockResolvedValueOnce([]); // metadata query returns empty

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"], limit: 10 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toHaveLength(2);
    expect(data.events[0].id).toBe("evt1"); // sorted by created_at desc
    expect(data.events[1].id).toBe("evt2");
    expect(data.profiles).toBeDefined();
  });

  it("sorts events by created_at descending", async () => {
    mockQuerySync
      .mockResolvedValueOnce([
        { id: "old", pubkey: "p1", content: "old", created_at: 100, tags: [] },
        { id: "new", pubkey: "p1", content: "new", created_at: 300, tags: [] },
        { id: "mid", pubkey: "p1", content: "mid", created_at: 200, tags: [] },
      ])
      .mockResolvedValueOnce([]);

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    const data = await res.json();
    expect(data.events.map((e: { id: string }) => e.id)).toEqual(["new", "mid", "old"]);
  });

  it("fetches and returns profile metadata for event authors", async () => {
    mockQuerySync
      .mockResolvedValueOnce([
        { id: "e1", pubkey: "pub-author", content: "test", created_at: 1700000000, tags: [] },
      ])
      .mockResolvedValueOnce([
        { pubkey: "pub-author", content: JSON.stringify({ display_name: "Alice", picture: "https://pic.example/a.jpg" }), created_at: 1699999999 },
      ]);

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    const data = await res.json();
    expect(data.profiles["pub-author"]).toEqual({
      name: "Alice",
      picture: "https://pic.example/a.jpg",
    });
  });

  it("uses name fallback when display_name is absent", async () => {
    mockQuerySync
      .mockResolvedValueOnce([
        { id: "e1", pubkey: "pub1", content: "test", created_at: 1700000000, tags: [] },
      ])
      .mockResolvedValueOnce([
        { pubkey: "pub1", content: JSON.stringify({ name: "bob" }), created_at: 1699999999 },
      ]);

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    const data = await res.json();
    expect(data.profiles["pub1"].name).toBe("bob");
  });

  it("handles invalid metadata JSON gracefully", async () => {
    mockQuerySync
      .mockResolvedValueOnce([
        { id: "e1", pubkey: "pub1", content: "test", created_at: 1700000000, tags: [] },
      ])
      .mockResolvedValueOnce([
        { pubkey: "pub1", content: "{{not json", created_at: 1699999999 },
      ]);

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profiles["pub1"]).toBeUndefined(); // skipped due to JSON parse error
  });

  it("deduplicates profile metadata (keeps first)", async () => {
    mockQuerySync
      .mockResolvedValueOnce([
        { id: "e1", pubkey: "dup-pub", content: "test", created_at: 1700000000, tags: [] },
      ])
      .mockResolvedValueOnce([
        { pubkey: "dup-pub", content: JSON.stringify({ name: "First" }), created_at: 1700000000 },
        { pubkey: "dup-pub", content: JSON.stringify({ name: "Second" }), created_at: 1700000001 },
      ]);

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    const data = await res.json();
    expect(data.profiles["dup-pub"].name).toBe("First");
  });

  it("continues without profiles when metadata query times out", async () => {
    mockQuerySync
      .mockResolvedValueOnce([
        { id: "e1", pubkey: "pub1", content: "test", created_at: 1700000000, tags: [] },
      ])
      .mockRejectedValueOnce(new Error("meta-timeout")); // metadata query fails

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toHaveLength(1);
    expect(data.profiles).toEqual({});
  });

  it("returns timeout warning when main query times out", async () => {
    mockQuerySync.mockRejectedValueOnce(new Error("timeout"));

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toEqual([]);
    expect(data.warning).toContain("timed out");
  });

  it("returns 502 for non-timeout relay errors", async () => {
    mockQuerySync.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("Connection refused");
  });

  it("closes pool in finally block after success", async () => {
    mockQuerySync.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    expect(mockClose).toHaveBeenCalledWith(["wss://relay.damus.io"]);
  });

  it("closes pool in finally block after error", async () => {
    mockQuerySync.mockRejectedValueOnce(new Error("fail"));

    await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    expect(mockClose).toHaveBeenCalledWith(["wss://relay.damus.io"]);
  });

  it("skips profiles when no events returned", async () => {
    mockQuerySync.mockResolvedValueOnce([]);

    const res = await POST(makeRequest({ relays: ["wss://relay.damus.io"] }));
    const data = await res.json();
    expect(data.events).toEqual([]);
    expect(data.profiles).toEqual({});
    // querySync should only have been called once (no metadata query)
    expect(mockQuerySync).toHaveBeenCalledTimes(1);
  });

  it("applies pubkeys filter when provided", async () => {
    mockQuerySync.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await POST(makeRequest({
      relays: ["wss://relay.damus.io"],
      pubkeys: ["abc123"],
      limit: 5,
    }));

    expect(mockQuerySync).toHaveBeenCalledWith(
      ["wss://relay.damus.io"],
      expect.objectContaining({ authors: ["abc123"], limit: 5 }),
    );
  });

  it("applies hashtags filter when provided", async () => {
    mockQuerySync.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await POST(makeRequest({
      relays: ["wss://relay.damus.io"],
      hashtags: ["bitcoin", "nostr"],
    }));

    expect(mockQuerySync).toHaveBeenCalledWith(
      ["wss://relay.damus.io"],
      expect.objectContaining({ "#t": ["bitcoin", "nostr"] }),
    );
  });

  it("applies since filter when provided", async () => {
    mockQuerySync.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await POST(makeRequest({
      relays: ["wss://relay.damus.io"],
      since: 1700000000,
    }));

    expect(mockQuerySync).toHaveBeenCalledWith(
      ["wss://relay.damus.io"],
      expect.objectContaining({ since: 1700000000 }),
    );
  });
});
