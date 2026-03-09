import { POST as rssPost } from "@/app/api/fetch/rss/route";
import { POST as discoverPost } from "@/app/api/fetch/discover-feed/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

jest.mock("@/lib/utils/url", () => {
  const actual = jest.requireActual("@/lib/utils/url");
  return {
    ...actual,
    safeFetch: jest.fn(),
  };
});

import { safeFetch } from "@/lib/utils/url";
const mockSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Test Item</title>
      <link>https://example.com/1</link>
      <description>Test description content here for article</description>
    </item>
  </channel>
</rss>`;

describe("Cache-Control headers", () => {
  beforeEach(() => {
    _resetRateLimits();
    mockSafeFetch.mockReset();
  });

  describe("RSS route", () => {
    it("sets Cache-Control with s-maxage=300 on success", async () => {
      mockSafeFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/xml" }),
        text: () => Promise.resolve(SAMPLE_RSS),
      } as unknown as Response);

      const res = await rssPost(
        makeRequest("http://localhost:3000/api/fetch/rss", {
          feedUrl: "https://example.com/feed.xml",
        }),
      );
      expect(res.status).toBe(200);
      const cc = res.headers.get("Cache-Control");
      expect(cc).toBe("public, s-maxage=300, stale-while-revalidate=60");
    });

    it("does not set Cache-Control on error responses", async () => {
      mockSafeFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
      } as unknown as Response);

      const res = await rssPost(
        makeRequest("http://localhost:3000/api/fetch/rss", {
          feedUrl: "https://example.com/feed.xml",
        }),
      );
      expect(res.status).toBe(502);
      const cc = res.headers.get("Cache-Control");
      expect(cc).toBeNull();
    });
  });

  describe("Discover-feed route", () => {
    it("sets Cache-Control with s-maxage=600 on success", async () => {
      const html = `<html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="RSS" />
      </head><body></body></html>`;

      mockSafeFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html", "content-length": "200" }),
        text: () => Promise.resolve(html),
      } as unknown as Response);

      const res = await discoverPost(
        makeRequest("http://localhost:3000/api/fetch/discover-feed", {
          url: "https://example.com",
        }),
      );
      expect(res.status).toBe(200);
      const cc = res.headers.get("Cache-Control");
      expect(cc).toBe("public, s-maxage=600, stale-while-revalidate=60");
    });

    it("sets Cache-Control even when no feeds found", async () => {
      const html = `<html><head><title>No feeds</title></head><body></body></html>`;

      mockSafeFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
      } as unknown as Response);

      const res = await discoverPost(
        makeRequest("http://localhost:3000/api/fetch/discover-feed", {
          url: "https://nofeed.com",
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.feeds).toEqual([]);
      const cc = res.headers.get("Cache-Control");
      expect(cc).toBe("public, s-maxage=600, stale-while-revalidate=60");
    });
  });
});
