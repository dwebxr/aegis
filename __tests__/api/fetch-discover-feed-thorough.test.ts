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

describe("POST /api/fetch/discover-feed — thorough coverage", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  // ─── HTTP error response handling ───

  describe("HTTP error responses from target site", () => {
    it("falls through to probing when HTML fetch returns 404", async () => {
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        // HTML fetch returns 404
        return { ok: false, status: 404, headers: new Headers(), text: async () => "Not Found" };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.feeds).toEqual([]);
    });

    it("falls through to probing when HTML fetch returns 500", async () => {
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return { ok: false, status: 500, headers: new Headers() };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.feeds).toEqual([]);
    });

    it("falls through to probing when HTML fetch returns 403", async () => {
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return { ok: false, status: 403, headers: new Headers() };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.feeds).toEqual([]);
    });
  });

  // ─── Oversized content handling ───

  describe("oversized response handling", () => {
    it("skips body parsing when Content-Length > 5MB", async () => {
      const textMock = jest.fn().mockResolvedValue("<html></html>");
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return {
          ok: true,
          headers: new Headers({ "content-length": "6000000" }),
          text: textMock,
        };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      expect(res.status).toBe(200);
      // text() should NOT have been called since content-length > 5MB
      expect(textMock).not.toHaveBeenCalled();
    });

    it("truncates HTML at 2MB when response is between 2-5MB", async () => {
      // Create HTML with a feed link placed AFTER the 2MB mark
      const padding = "x".repeat(2_000_010);
      const html = `<html><head>${padding}<link rel="alternate" type="application/rss+xml" href="/after-truncation.xml" /></head></html>`;

      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return {
          ok: true,
          headers: new Headers(),
          text: async () => html,
        };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      // Feed link is after 2MB truncation point, so it should NOT be found
      expect(data.feeds.some((f: { url: string }) => f.url.includes("after-truncation"))).toBe(false);
    });

    it("finds feed link within 2MB of large response", async () => {
      // Place feed link BEFORE padding
      const padding = "x".repeat(1_000_000);
      const html = `<html><head><link rel="alternate" type="application/rss+xml" href="/found.xml" />${padding}</head></html>`;

      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return {
          ok: true,
          headers: new Headers(),
          text: async () => html,
        };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.some((f: { url: string }) => f.url.includes("found.xml"))).toBe(true);
    });
  });

  // ─── Link tag regex iteration limit ───

  describe("link tag regex iteration limit", () => {
    it("stops processing after 100 link tags", async () => {
      const tags = Array.from({ length: 120 }, (_, i) =>
        `<link rel="alternate" type="application/rss+xml" href="/feed-${i}.xml" />`
      ).join("\n");
      const html = `<html><head>${tags}</head></html>`;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      // Should find exactly 100 feeds (limit)
      expect(data.feeds.length).toBe(100);
    });
  });

  // ─── YouTube HTML fallback (extractYouTubeChannelId) ───

  describe("YouTube HTML fallback", () => {
    it("extracts channel ID from YouTube @handle page HTML", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><script>{"externalId":"UCddiUEpeqJcYeBxX1IVBKvQ","title":"Veritasium"}</script></html>`,
      });

      const res = await POST(makeRequest({ url: "https://youtube.com/@Veritasium" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toBe("https://www.youtube.com/feeds/videos.xml?channel_id=UCddiUEpeqJcYeBxX1IVBKvQ");
      expect(data.feeds[0].title).toBe("YouTube Channel");
    });

    it("returns empty feeds when YouTube page has no channel ID", async () => {
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return {
          ok: true,
          text: async () => `<html><body>YouTube page without channel info</body></html>`,
        };
      });

      const res = await POST(makeRequest({ url: "https://youtube.com/@nonexistent" }));
      const data = await res.json();
      expect(data.feeds).toEqual([]);
    });

    it("extracts channel ID from m.youtube.com HTML", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><meta itemprop="channelId" content="UCtest_mobile_1234567"></html>`,
      });

      const res = await POST(makeRequest({ url: "https://m.youtube.com/@Channel" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toContain("channel_id=UCtest_mobile_1234567");
    });
  });

  // ─── Platform detection fast path ───

  describe("platform detection fast path", () => {
    it("returns YouTube channel feed without HTML fetch", async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      const res = await POST(makeRequest({ url: "https://youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ" }));
      const data = await res.json();

      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toContain("channel_id=UCddiUEpeqJcYeBxX1IVBKvQ");
      // Should NOT have made any fetch calls (platform detection shortcut)
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns GitHub releases feed without HTML fetch", async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      const res = await POST(makeRequest({ url: "https://github.com/vercel/next.js" }));
      const data = await res.json();

      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toBe("https://github.com/vercel/next.js/releases.atom");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns Reddit RSS feed without HTML fetch", async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      const res = await POST(makeRequest({ url: "https://reddit.com/r/programming" }));
      const data = await res.json();

      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toBe("https://www.reddit.com/r/programming/.rss");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns Bluesky RSS feed without HTML fetch", async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      const res = await POST(makeRequest({ url: "https://bsky.app/profile/jay.bsky.social" }));
      const data = await res.json();

      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toBe("https://bsky.app/profile/jay.bsky.social/rss");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns Mastodon RSS feed without HTML fetch for /@handle", async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      const res = await POST(makeRequest({ url: "https://mastodon.social/@gargron" }));
      const data = await res.json();

      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toBe("https://mastodon.social/@gargron.rss");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ─── HTML parsing edge cases ───

  describe("HTML parsing edge cases", () => {
    it("handles link tags with single quotes", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><link rel='alternate' type='application/rss+xml' href='/feed.xml' title='My Feed' /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toBe("https://example.com/feed.xml");
    });

    it("handles link tags with extra whitespace", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><link  rel="alternate"  type="application/rss+xml"  href="/feed.xml"  /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
    });

    it("handles link tag without title attribute", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].title).toBeUndefined();
    });

    it("handles atom feed type", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds[0].type).toBe("atom");
    });

    it("skips link tags with type='text/html' (non-feed)", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head>
          <link rel="alternate" type="text/html" href="/page.html" />
          <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
        </head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toContain("feed.xml");
    });

    it("handles link tag with type containing xml (generic XML feed)", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head><link rel="alternate" type="text/xml" href="/feed.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
    });

    it("handles link tags spread across body (not just head)", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head></head><body><link rel="alternate" type="application/rss+xml" href="/body-feed.xml" /></body></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      // Regex matches across entire HTML
      expect(data.feeds.length).toBe(1);
      expect(data.feeds[0].url).toContain("body-feed.xml");
    });
  });

  // ─── Input validation edge cases ───

  describe("input validation edge cases", () => {
    it("returns 400 for URL with fragment only", async () => {
      const res = await POST(makeRequest({ url: "#fragment" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for javascript: URL", async () => {
      const res = await POST(makeRequest({ url: "javascript:alert(1)" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for data: URL", async () => {
      const res = await POST(makeRequest({ url: "data:text/html,<h1>test</h1>" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for file: URL", async () => {
      const res = await POST(makeRequest({ url: "file:///etc/passwd" }));
      expect(res.status).toBe(400);
    });

    it("blocks SSRF via 10.x.x.x private IP", async () => {
      const res = await POST(makeRequest({ url: "http://10.0.0.1" }));
      expect(res.status).toBe(400);
    });

    it("blocks SSRF via 172.16.x.x private IP", async () => {
      const res = await POST(makeRequest({ url: "http://172.16.0.1" }));
      expect(res.status).toBe(400);
    });

    it("handles URL with port number", async () => {
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return { ok: true, text: async () => "<html></html>" };
      });

      const res = await POST(makeRequest({ url: "https://example.com:8443" }));
      expect(res.status).toBe(200);
    });

    it("handles URL with long path", async () => {
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return { ok: true, text: async () => "<html></html>" };
      });

      const longPath = "/" + "a".repeat(500);
      const res = await POST(makeRequest({ url: `https://example.com${longPath}` }));
      expect(res.status).toBe(200);
    });

    it("returns 400 for null url value", async () => {
      const res = await POST(makeRequest({ url: null }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for array url value", async () => {
      const res = await POST(makeRequest({ url: ["https://example.com"] }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for boolean url value", async () => {
      const res = await POST(makeRequest({ url: true }));
      expect(res.status).toBe(400);
    });
  });

  // ─── Concurrent probe behavior ───

  describe("concurrent probe behavior", () => {
    it("probes all paths in parallel (not sequentially)", async () => {
      const callTimestamps: number[] = [];
      global.fetch = jest.fn().mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          callTimestamps.push(Date.now());
          // Add small delay to verify parallel execution
          await new Promise(r => setTimeout(r, 50));
          return { ok: false, headers: new Headers() };
        }
        return { ok: true, text: async () => "<html></html>" };
      });

      const start = Date.now();
      await POST(makeRequest({ url: "https://example.com" }));
      const elapsed = Date.now() - start;

      // 6 probes at 50ms each — if parallel, total should be ~50ms (not 300ms+)
      // Allow generous buffer for CI
      expect(elapsed).toBeLessThan(250);
      expect(callTimestamps.length).toBe(6);
    });

    it("returns all successful probes even when some fail", async () => {
      let probeCount = 0;
      global.fetch = jest.fn().mockImplementation(async (url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD") {
          probeCount++;
          if ((url as string).endsWith("/feed")) {
            return { ok: true, headers: new Headers({ "content-type": "application/rss+xml" }) };
          }
          if ((url as string).endsWith("/atom.xml")) {
            return { ok: true, headers: new Headers({ "content-type": "application/atom+xml" }) };
          }
          if ((url as string).endsWith("/rss")) {
            throw new Error("Connection refused");
          }
          return { ok: false, headers: new Headers() };
        }
        return { ok: true, text: async () => "<html></html>" };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(2);
      expect(probeCount).toBe(6);
    });
  });

  // ─── Missing Content-Length header ───

  describe("Content-Length header handling", () => {
    it("processes normally when Content-Length is missing", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(), // No content-length
        text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
    });

    it("processes normally when Content-Length is 0", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": "0" }),
        text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      expect(data.feeds.length).toBe(1);
    });

    it("processes normally when Content-Length is not a number", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": "unknown" }),
        text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml" /></head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();
      // parseInt("unknown", 10) → NaN, which is not > 5_000_000, so body is processed
      expect(data.feeds.length).toBe(1);
    });
  });

  // ─── SSRF protection on probe URLs ───

  describe("SSRF protection on probe URLs", () => {
    it("does not probe private IP origins", async () => {
      // This URL would pass initial validation but probed paths should be blocked
      // Actually the initial blockPrivateUrl check catches this
      const res = await POST(makeRequest({ url: "http://192.168.1.1/blog" }));
      expect(res.status).toBe(400);
    });
  });

  // ─── Response data integrity ───

  describe("response data integrity", () => {
    it("returns correct feed structure for link-discovered feeds", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><head>
          <link rel="alternate" type="application/rss+xml" title="My Blog" href="/feed.xml" />
        </head></html>`,
      });

      const res = await POST(makeRequest({ url: "https://myblog.example.com" }));
      const data = await res.json();

      expect(data.feeds).toEqual([{
        url: "https://myblog.example.com/feed.xml",
        title: "My Blog",
        type: "rss",
      }]);
    });

    it("returns correct feed structure for probe-discovered feeds", async () => {
      global.fetch = jest.fn().mockImplementation(async (url: string, opts?: { method?: string }) => {
        if (opts?.method === "HEAD" && (url as string).endsWith("/rss.xml")) {
          return { ok: true, headers: new Headers({ "content-type": "application/rss+xml" }) };
        }
        if (opts?.method === "HEAD") {
          return { ok: false, headers: new Headers() };
        }
        return { ok: true, text: async () => "<html></html>" };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      const data = await res.json();

      expect(data.feeds).toEqual([{
        url: "https://example.com/rss.xml",
        type: "rss",
      }]);
    });

    it("returns feeds array (not object) even when platform detected", async () => {
      const res = await POST(makeRequest({ url: "https://reddit.com/r/javascript" }));
      const data = await res.json();
      expect(Array.isArray(data.feeds)).toBe(true);
      expect(data.feeds[0]).toHaveProperty("url");
      expect(data.feeds[0]).toHaveProperty("title");
      expect(data.feeds[0]).toHaveProperty("type");
    });
  });
});
