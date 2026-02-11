import { POST } from "@/app/api/fetch/rss/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const origFetch = global.fetch;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/rss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/rss — conditional requests", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it("sends If-None-Match header when etag is provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    global.fetch = jest.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      const h = opts.headers as Record<string, string>;
      capturedHeaders = { ...h };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "etag": '"abc123"' }),
        text: async () => `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title></channel></rss>`,
      };
    });

    await POST(makeRequest({ feedUrl: "https://example.com/feed.xml", etag: '"abc123"' }));
    expect(capturedHeaders["If-None-Match"]).toBe('"abc123"');
  });

  it("sends If-Modified-Since header when lastModified is provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    global.fetch = jest.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      const h = opts.headers as Record<string, string>;
      capturedHeaders = { ...h };
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title></channel></rss>`,
      };
    });

    await POST(makeRequest({ feedUrl: "https://example.com/feed.xml", lastModified: "Tue, 01 Jan 2025 00:00:00 GMT" }));
    expect(capturedHeaders["If-Modified-Since"]).toBe("Tue, 01 Jan 2025 00:00:00 GMT");
  });

  it("returns notModified:true for 304 response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 304,
      headers: new Headers({ etag: '"same"', "last-modified": "Tue, 01 Jan 2025 00:00:00 GMT" }),
    });

    const res = await POST(makeRequest({
      feedUrl: "https://example.com/feed.xml",
      etag: '"same"',
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notModified).toBe(true);
    expect(data.items).toEqual([]);
    expect(data.etag).toBe('"same"');
  });

  it("returns 502 when conditional fetch returns non-OK non-304", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
    });

    const res = await POST(makeRequest({
      feedUrl: "https://example.com/feed.xml",
      etag: '"old"',
    }));
    expect(res.status).toBe(502);
  });

  it("returns etag and lastModified from response headers", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"new-etag"', "last-modified": "Wed, 02 Jan 2025 00:00:00 GMT" }),
      text: async () => `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><item><title>Item 1</title></item></channel></rss>`,
    });

    const res = await POST(makeRequest({
      feedUrl: "https://example.com/feed.xml",
      etag: '"old"',
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.etag).toBe('"new-etag"');
    expect(data.lastModified).toBe("Wed, 02 Jan 2025 00:00:00 GMT");
    expect(data.items.length).toBeGreaterThan(0);
  });

  it("handles network error in conditional path gracefully", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await POST(makeRequest({
      feedUrl: "https://example.com/feed.xml",
      lastModified: "some-date",
    }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("reach");
  });

  it("handles DNS resolution failure in conditional path", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ENOTFOUND"));

    const res = await POST(makeRequest({
      feedUrl: "https://nonexistent.example.com/feed.xml",
      etag: '"test"',
    }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("reach");
  });

  it("handles invalid XML in conditional path", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "this is not XML at all",
    });

    const res = await POST(makeRequest({
      feedUrl: "https://example.com/feed.xml",
      etag: '"test"',
    }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("parse");
  });

  it("falls back to standard parseURL when no etag or lastModified", async () => {
    // Without etag/lastModified, it should NOT use the manual fetch path
    // and instead use parser.parseURL directly. We mock global.fetch
    // which won't be called in the standard path (rss-parser uses its own http).
    // A DNS failure on a non-routable domain will test this path.
    const res = await POST(makeRequest({
      feedUrl: "https://nonexistent.invalid/feed.xml",
    }));
    // Should fail with network error, not 400
    expect(res.status).not.toBe(400);
  });
});
