/**
 * Tests for lib/ingestion/fetchers.ts — covers fetchFarcaster (previously uncovered)
 * and edge cases for all fetcher functions.
 */

const mockFetch = jest.fn();
const originalFetch = global.fetch;

import { fetchRSS, fetchNostr, fetchURL, fetchFarcaster } from "@/lib/ingestion/fetchers";
import type { FetcherCallbacks, HttpCacheHeaders } from "@/lib/ingestion/fetchers";

function makeCallbacks(): FetcherCallbacks {
  return {
    handleFetchError: jest.fn(),
    recordSourceError: jest.fn(),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("fetchFarcaster", () => {
  it("returns items for valid fid", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { text: "Cast 1", author: "Alice", avatar: "https://img.com/a.png", sourceUrl: "https://warpcast.com/alice/0x1" },
          { text: "Cast 2", author: "Alice" },
        ],
      }),
    });

    const cb = makeCallbacks();
    const result = await fetchFarcaster("5650", "alice", "farcaster:alice", cb);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Cast 1");
    expect(result[0].author).toBe("Alice");
    expect(result[0].avatar).toBe("https://img.com/a.png");
    expect(result[1].author).toBe("Alice");
  });

  it("returns empty and records error for invalid fid", async () => {
    const cb = makeCallbacks();
    const result = await fetchFarcaster("not-a-number", "user", "farcaster:user", cb);
    expect(result).toEqual([]);
    expect(cb.recordSourceError).toHaveBeenCalledWith("farcaster:user", expect.stringContaining("Invalid fid"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns empty and records error for Infinity fid", async () => {
    const cb = makeCallbacks();
    const result = await fetchFarcaster("Infinity", "user", "farcaster:user", cb);
    expect(result).toEqual([]);
    expect(cb.recordSourceError).toHaveBeenCalled();
  });

  it("returns empty and records error for empty string fid", async () => {
    const cb = makeCallbacks();
    const result = await fetchFarcaster("", "user", "farcaster:user", cb);
    expect(result).toEqual([]);
    expect(cb.recordSourceError).toHaveBeenCalled();
  });

  it("handles fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));
    const cb = makeCallbacks();
    const result = await fetchFarcaster("123", "user", "farcaster:user", cb);
    expect(result).toEqual([]);
    expect(cb.recordSourceError).toHaveBeenCalledWith("farcaster:user", "Network failure");
  });

  it("handles non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const cb = makeCallbacks();
    const result = await fetchFarcaster("123", "user", "farcaster:user", cb);
    expect(result).toEqual([]);
    expect(cb.handleFetchError).toHaveBeenCalled();
  });

  it("truncates text to 2000 chars", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ text: "x".repeat(5000), author: "User" }],
      }),
    });

    const cb = makeCallbacks();
    const result = await fetchFarcaster("1", "user", "key", cb);
    expect(result[0].text.length).toBeLessThanOrEqual(2000);
  });

  it("falls back to username then fid for author", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { text: "cast1", author: "" },          // empty author → uses username
          { text: "cast2" },                       // missing author → uses username
        ],
      }),
    });

    const cb = makeCallbacks();
    const result = await fetchFarcaster("42", "alice", "key", cb);
    expect(result[0].author).toBe("alice");
    expect(result[1].author).toBe("alice");
  });

  it("falls back to fid when username also empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ text: "cast", author: "" }],
      }),
    });

    const cb = makeCallbacks();
    const result = await fetchFarcaster("42", "", "key", cb);
    expect(result[0].author).toBe("fid:42");
  });
});

describe("fetchRSS", () => {
  it("returns items from API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feedTitle: "Test Feed",
        items: [
          { title: "Post 1", content: "Content 1", author: "Author", link: "https://example.com/1" },
        ],
      }),
    });

    const cb = makeCallbacks();
    const cache: HttpCacheHeaders = new Map();
    const result = await fetchRSS("https://example.com/feed.xml", "rss:example", cache, cb);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("Post 1");
    expect(result[0].text).toContain("Content 1");
    expect(result[0].author).toBe("Author");
    expect(result[0].sourceUrl).toBe("https://example.com/1");
  });

  it("stores cache headers from response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        etag: '"abc"',
        lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
        items: [],
      }),
    });

    const cb = makeCallbacks();
    const cache: HttpCacheHeaders = new Map();
    await fetchRSS("https://example.com/feed.xml", "rss:example", cache, cb);
    expect(cache.get("rss:example")).toEqual({ etag: '"abc"', lastModified: "Mon, 01 Jan 2024 00:00:00 GMT" });
  });

  it("sends cached etag/lastModified in request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notModified: true }),
    });

    const cb = makeCallbacks();
    const cache: HttpCacheHeaders = new Map([["rss:example", { etag: '"cached"', lastModified: "date" }]]);
    const result = await fetchRSS("https://example.com/feed.xml", "rss:example", cache, cb);
    expect(result).toEqual([]); // notModified

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.etag).toBe('"cached"');
    expect(body.lastModified).toBe("date");
  });

  it("falls back to feedTitle when author missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feedTitle: "Feed Name",
        items: [{ title: "T", content: "C" }],
      }),
    });

    const cb = makeCallbacks();
    const cache: HttpCacheHeaders = new Map();
    const result = await fetchRSS("https://example.com/feed.xml", "key", cache, cb);
    expect(result[0].author).toBe("Feed Name");
  });

  it("falls back to 'RSS' when both author and feedTitle missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ title: "T", content: "C" }] }),
    });

    const cb = makeCallbacks();
    const cache: HttpCacheHeaders = new Map();
    const result = await fetchRSS("https://example.com/feed.xml", "key", cache, cb);
    expect(result[0].author).toBe("RSS");
  });

  it("truncates combined title+content to 2000 chars", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ title: "T", content: "x".repeat(3000) }],
      }),
    });

    const cb = makeCallbacks();
    const cache: HttpCacheHeaders = new Map();
    const result = await fetchRSS("https://example.com/feed.xml", "key", cache, cb);
    expect(result[0].text.length).toBeLessThanOrEqual(2000);
  });

  it("handles non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });
    const cb = makeCallbacks();
    const cache: HttpCacheHeaders = new Map();
    const result = await fetchRSS("https://example.com/feed.xml", "key", cache, cb);
    expect(result).toEqual([]);
    expect(cb.handleFetchError).toHaveBeenCalled();
  });

  it("handles network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));
    const cb = makeCallbacks();
    const cache: HttpCacheHeaders = new Map();
    const result = await fetchRSS("https://example.com/feed.xml", "key", cache, cb);
    expect(result).toEqual([]);
    expect(cb.recordSourceError).toHaveBeenCalledWith("key", "timeout");
  });
});

describe("fetchNostr", () => {
  it("returns events with profile enrichment", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        profiles: { "pubkey1": { name: "Alice", picture: "https://img.com/alice.png" } },
        events: [
          { content: "Hello nostr", pubkey: "pubkey1", id: "event1" },
        ],
      }),
    });

    const cb = makeCallbacks();
    const result = await fetchNostr(["wss://relay.example.com"], ["pubkey1"], "nostr:relay", cb);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe("Alice");
    expect(result[0].avatar).toBe("https://img.com/alice.png");
    expect(result[0].sourceUrl).toBe("nostr:event1");
    expect(result[0].nostrPubkey).toBe("pubkey1");
  });

  it("truncates pubkey for unknown profiles", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        profiles: {},
        events: [{ content: "Text", pubkey: "abcdef1234567890abcdef", id: "e1" }],
      }),
    });

    const cb = makeCallbacks();
    const result = await fetchNostr(["wss://relay.example.com"], undefined, "nostr:relay", cb);
    expect(result[0].author).toBe("abcdef123456...");
  });

  it("filters empty pubkeys", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [], profiles: {} }),
    });

    const cb = makeCallbacks();
    await fetchNostr(["wss://relay.example.com"], ["", "", "valid"], "nostr:relay", cb);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.pubkeys).toEqual(["valid"]);
  });

  it("sends undefined pubkeys when all empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [], profiles: {} }),
    });

    const cb = makeCallbacks();
    await fetchNostr(["wss://relay.example.com"], ["", ""], "nostr:relay", cb);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.pubkeys).toBeUndefined();
  });
});

describe("fetchURL", () => {
  it("returns single item for valid URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        title: "Page Title",
        content: "Page content here",
        author: "Page Author",
        imageUrl: "https://example.com/og.png",
      }),
    });

    const cb = makeCallbacks();
    const result = await fetchURL("https://example.com/page", "url:example", cb);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("Page Title");
    expect(result[0].text).toContain("Page content here");
    expect(result[0].author).toBe("Page Author");
    expect(result[0].sourceUrl).toBe("https://example.com/page");
    expect(result[0].imageUrl).toBe("https://example.com/og.png");
  });

  it("uses hostname as fallback author", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: "T", content: "C" }),
    });

    const cb = makeCallbacks();
    const result = await fetchURL("https://blog.example.com/post", "url:blog", cb);
    expect(result[0].author).toBe("blog.example.com");
  });

  it("handles malformed URL gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: "T", content: "C" }),
    });

    const cb = makeCallbacks();
    const result = await fetchURL("not-a-valid-url", "url:bad", cb);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe("unknown");
  });

  it("handles missing title and content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const cb = makeCallbacks();
    const result = await fetchURL("https://example.com", "url:x", cb);
    expect(result[0].text).toBeDefined();
  });
});
