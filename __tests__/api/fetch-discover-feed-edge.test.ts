import { POST } from "@/app/api/fetch/discover-feed/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const origFetch = global.fetch;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/discover-feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/discover-feed — edge cases", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  describe("URL resolution", () => {
    it("resolves relative href starting with /", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="/blog/feed.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com/blog" }));
      const data = await res.json();
      expect(data.feeds[0].url).toBe("https://example.com/blog/feed.xml");
    });

    it("resolves relative href without leading /", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="feed.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com/blog/" }));
      const data = await res.json();
      expect(data.feeds[0].url).toBe("https://example.com/blog/feed.xml");
    });

    it("keeps absolute href URLs unchanged", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="https://feeds.example.com/main.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds[0].url).toBe("https://feeds.example.com/main.xml");
    });
  });

  describe("multiple link tags", () => {
    it("discovers multiple feeds from the same page", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head>
          <link rel="alternate" type="application/rss+xml" title="Main RSS" href="/feed.xml" />
          <link rel="alternate" type="application/atom+xml" title="Atom Feed" href="/atom.xml" />
        </head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(2);
      expect(data.feeds[0].type).toBe("rss");
      expect(data.feeds[1].type).toBe("atom");
    });

    it("skips link tags without href", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head>
          <link rel="alternate" type="application/rss+xml" title="No Href" />
          <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="Has Href" />
        </head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].title).toBe("Has Href");
    });

    it("skips link tags with non-feed types", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head>
          <link rel="alternate" type="text/html" href="/other" />
          <link rel="alternate" type="application/json" href="/api" />
          <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
        </head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
    });
  });

  describe("common path probing", () => {
    it("probes all 6 common paths when no link tags found", async () => {
      const probedUrls: string[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          probedUrls.push(url);
          return { ok: false, headers: new Headers() };
        }
        // HTML fetch — no link tags
        return { ok: true, text: async () => "<html><body>No feeds</body></html>" };
      });

      await POST(makeRequest({ url: "https://example.com" }));

      // Should probe /feed, /rss, /feed.xml, /atom.xml, /rss.xml, /index.xml
      expect(probedUrls.length).toBe(6);
      expect(probedUrls).toContain("https://example.com/feed");
      expect(probedUrls).toContain("https://example.com/rss");
      expect(probedUrls).toContain("https://example.com/feed.xml");
      expect(probedUrls).toContain("https://example.com/atom.xml");
      expect(probedUrls).toContain("https://example.com/rss.xml");
      expect(probedUrls).toContain("https://example.com/index.xml");
    });

    it("skips probing when link tags are found", async () => {
      let headCallCount = 0;
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          headCallCount++;
          return { ok: false, headers: new Headers() };
        }
        return {
          ok: true,
          text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml" /></head></html>`,
        };
      });

      await POST(makeRequest({ url: "https://example.com" }));
      expect(headCallCount).toBe(0);
    });

    it("detects feed by content-type with charset", async () => {
      global.fetch = jest.fn().mockImplementation(async (url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD" && (url as string).endsWith("/feed.xml")) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "application/rss+xml; charset=utf-8" }),
          };
        }
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return { ok: true, text: async () => "<html><body>No feeds</body></html>" };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("returns empty feeds when HTML fetch fails", async () => {
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        throw new Error("Network error");
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      // Falls through to probing, which all fail
      expect(data.feeds).toEqual([]);
    });

    it("handles partial probe failures gracefully", async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async (url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          callCount++;
          if ((url as string).endsWith("/feed")) {
            return {
              ok: true,
              headers: new Headers({ "content-type": "application/rss+xml" }),
            };
          }
          if (callCount % 2 === 0) throw new Error("Timeout");
          return { ok: false, headers: new Headers() };
        }
        return { ok: true, text: async () => "<html><body>No feeds</body></html>" };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      // Should still find /feed despite some probes failing
      expect(data.feeds.some((f: { url: string }) => f.url.endsWith("/feed"))).toBe(true);
    });

    it("rate limits at 15 requests per minute", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => "<html></html>",
        headers: new Headers(),
      });

      for (let i = 0; i < 15; i++) {
        const res = await POST(makeRequest({ url: `https://example${i}.com` }));
        expect(res.status).not.toBe(429);
      }

      const res = await POST(makeRequest({ url: "https://example99.com" }));
      expect(res.status).toBe(429);
    });
  });
});
