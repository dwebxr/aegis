/**
 * Extended tests for RSS route — covers HTTP caching, feed parsing errors,
 * and response structure beyond basic input validation.
 */

const mockSafeFetch = jest.fn();
jest.mock("@/lib/utils/url", () => ({
  blockPrivateUrl: jest.fn(() => null),
  safeFetch: mockSafeFetch,
}));

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

beforeEach(() => {
  _resetRateLimits();
  mockSafeFetch.mockReset();
});

describe("POST /api/fetch/rss — HTTP caching", () => {
  it("returns 304-style notModified when feed returns 304", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
      headers: new Headers({ etag: '"abc123"', "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT" }),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml", etag: '"abc123"' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notModified).toBe(true);
    expect(data.etag).toBe('"abc123"');
    expect(data.items).toEqual([]);
  });

  it("forwards etag and lastModified as conditional headers", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
      headers: new Headers(),
    });

    await POST(makeRequest({
      feedUrl: "https://example.com/feed.xml",
      etag: '"etag-val"',
      lastModified: "Thu, 01 Feb 2025 00:00:00 GMT",
    }));

    const fetchCall = mockSafeFetch.mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers["If-None-Match"]).toBe('"etag-val"');
    expect(headers["If-Modified-Since"]).toBe("Thu, 01 Feb 2025 00:00:00 GMT");
  });
});

describe("POST /api/fetch/rss — error responses", () => {
  it("returns 502 when feed returns non-ok HTTP status", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 500,
      ok: false,
      headers: new Headers(),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("HTTP 500");
  });

  it("returns 502 for ENOTFOUND error", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND example.invalid"));

    const res = await POST(makeRequest({ feedUrl: "https://example.invalid/feed.xml" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("reach this feed");
  });

  it("returns 422 for unparseable feed content", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => "<html>Not a feed</html>",
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/page.html" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("parse feed");
  });

  it("returns 502 for ECONNREFUSED error", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.1:443"));

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("reach this feed");
  });
});

describe("POST /api/fetch/rss — feed parsing", () => {
  const validRSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article 1</title>
      <description>Content of article 1</description>
      <link>https://example.com/article-1</link>
      <dc:creator>Author One</dc:creator>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Article 2</title>
      <description>&lt;p&gt;HTML &lt;b&gt;content&lt;/b&gt;&lt;/p&gt;</description>
      <link>https://example.com/article-2</link>
    </item>
  </channel>
</rss>`;

  it("parses valid RSS feed and returns structured items", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers({ etag: '"feed-etag"' }),
      text: async () => validRSS,
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.feedTitle).toBe("Test Feed");
    expect(data.etag).toBe('"feed-etag"');
    expect(data.items).toHaveLength(2);
    expect(data.items[0].title).toBe("Article 1");
    expect(data.items[0].link).toBe("https://example.com/article-1");
    expect(data.items[0].author).toBe("Author One");
  });

  it("strips HTML tags from content", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => validRSS,
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[1].content).not.toContain("<p>");
    expect(data.items[1].content).not.toContain("<b>");
    expect(data.items[1].content).toContain("HTML");
    expect(data.items[1].content).toContain("content");
  });

  it("respects limit parameter", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => validRSS,
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml", limit: 1 }));
    const data = await res.json();
    expect(data.items).toHaveLength(1);
  });

  it("caps limit at 50", async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => validRSS,
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml", limit: 100 }));
    const data = await res.json();
    // Only 2 items in feed, but limit shouldn't exceed 50
    expect(data.items.length).toBeLessThanOrEqual(50);
  });

  it("extracts image from enclosure", async () => {
    const rssWithImage = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Image Feed</title>
    <item>
      <title>Post</title>
      <description>Text</description>
      <enclosure url="https://example.com/photo.jpg" type="image/jpeg" />
    </item>
  </channel>
</rss>`;

    mockSafeFetch.mockResolvedValueOnce({
      status: 200, ok: true, headers: new Headers(),
      text: async () => rssWithImage,
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[0].imageUrl).toBe("https://example.com/photo.jpg");
  });

  it("extracts image from content img tag", async () => {
    const rssWithImgTag = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Img Feed</title>
    <item>
      <title>Post</title>
      <description>&lt;p&gt;Text&lt;/p&gt;&lt;img src="https://example.com/inline.png" /&gt;</description>
    </item>
  </channel>
</rss>`;

    mockSafeFetch.mockResolvedValueOnce({
      status: 200, ok: true, headers: new Headers(),
      text: async () => rssWithImgTag,
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[0].imageUrl).toBe("https://example.com/inline.png");
  });
});
