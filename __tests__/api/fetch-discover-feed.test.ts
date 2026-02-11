import { POST } from "@/app/api/fetch/discover-feed/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/discover-feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/discover-feed", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  describe("input validation", () => {
    it("returns 400 for missing url", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("required");
    });

    it("returns 400 for empty string url", async () => {
      const res = await POST(makeRequest({ url: "" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string url", async () => {
      const res = await POST(makeRequest({ url: 42 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid URL format", async () => {
      const res = await POST(makeRequest({ url: "not a url" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid URL");
    });

    it("blocks localhost (SSRF)", async () => {
      const res = await POST(makeRequest({ url: "http://127.0.0.1" }));
      expect(res.status).toBe(400);
    });

    it("blocks private IPs (SSRF)", async () => {
      const res = await POST(makeRequest({ url: "http://192.168.1.1" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost:3000/api/fetch/discover-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{broken",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON");
    });
  });

  describe("discovery with mocked fetch", () => {
    const origFetch = global.fetch;

    afterEach(() => {
      global.fetch = origFetch;
    });

    it("discovers feed from <link> tag in HTML", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `
          <html><head>
            <link rel="alternate" type="application/rss+xml" title="Blog RSS" href="/feed.xml" />
          </head><body></body></html>
        `,
      });

      const res = await POST(makeRequest({ url: "https://example.com/blog" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.feeds.length).toBeGreaterThan(0);
      expect(data.feeds[0].url).toBe("https://example.com/feed.xml");
      expect(data.feeds[0].title).toBe("Blog RSS");
    });

    it("probes common paths when no <link> tags found", async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async (url: string, opts?: { method?: string }) => {
        callCount++;
        if (opts?.method === "HEAD" && (url as string).endsWith("/feed")) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "application/rss+xml" }),
          };
        }
        if (callCount === 1) {
          // Initial HTML fetch - no link tags
          return { ok: true, text: async () => "<html><body>No feeds here</body></html>" };
        }
        return { ok: false, headers: new Headers() };
      });

      const res = await POST(makeRequest({ url: "https://example.com" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.feeds.some((f: { url: string }) => f.url.endsWith("/feed"))).toBe(true);
    });

    it("returns empty feeds array when nothing found", async () => {
      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: false,
        headers: new Headers(),
        text: async () => "",
      }));

      const res = await POST(makeRequest({ url: "https://no-feeds.example.com" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.feeds).toEqual([]);
    });
  });
});
