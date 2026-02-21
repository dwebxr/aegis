import { POST } from "@/app/api/fetch/ogimage/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/ogimage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Mock fetch globally for external URL fetching
const originalFetch = global.fetch;

describe("POST /api/fetch/ogimage", () => {
  beforeEach(() => {
    _resetRateLimits();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("input validation", () => {
    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost:3000/api/fetch/ogimage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json{",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON");
    });

    it("returns 400 for missing url field", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("URL is required");
    });

    it("returns 400 for non-string url", async () => {
      const res = await POST(makeRequest({ url: 123 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty string url", async () => {
      const res = await POST(makeRequest({ url: "" }));
      expect(res.status).toBe(400);
    });
  });

  describe("private URL blocking (SSRF prevention)", () => {
    it("blocks localhost URLs", async () => {
      const res = await POST(makeRequest({ url: "http://localhost:8080/admin" }));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.imageUrl).toBeNull();
    });

    it("blocks 127.0.0.1 URLs", async () => {
      const res = await POST(makeRequest({ url: "http://127.0.0.1/secret" }));
      const data = await res.json();
      expect(data.imageUrl).toBeNull();
    });

    it("blocks 10.x.x.x private IPs", async () => {
      const res = await POST(makeRequest({ url: "http://10.0.0.1/metadata" }));
      const data = await res.json();
      expect(data.imageUrl).toBeNull();
    });

    it("blocks 169.254.169.254 (cloud metadata)", async () => {
      const res = await POST(makeRequest({ url: "http://169.254.169.254/latest/meta-data" }));
      const data = await res.json();
      expect(data.imageUrl).toBeNull();
    });

    it("blocks file:// protocol", async () => {
      const res = await POST(makeRequest({ url: "file:///etc/passwd" }));
      const data = await res.json();
      expect(data.imageUrl).toBeNull();
    });
  });

  describe("OG image extraction", () => {
    function mockFetchWithHTML(html: string, status = 200) {
      const encoder = new TextEncoder();
      const chunks = [encoder.encode(html)];
      let chunkIdx = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: status >= 200 && status < 400,
        status,
        body: {
          getReader: () => ({
            read: async () => {
              if (chunkIdx < chunks.length) {
                return { done: false, value: chunks[chunkIdx++] };
              }
              return { done: true, value: undefined };
            },
            cancel: async () => {},
          }),
        },
      } as unknown as Response);
    }

    it("extracts og:image from property-first meta tag", async () => {
      mockFetchWithHTML(`
        <html><head>
          <meta property="og:image" content="https://example.com/img.jpg" />
        </head><body></body></html>
      `);
      const res = await POST(makeRequest({ url: "https://example.com/article" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://example.com/img.jpg");
    });

    it("extracts og:image from content-first meta tag", async () => {
      mockFetchWithHTML(`
        <html><head>
          <meta content="https://example.com/photo.png" property="og:image" />
        </head><body></body></html>
      `);
      const res = await POST(makeRequest({ url: "https://example.com/page" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://example.com/photo.png");
    });

    it("resolves relative og:image URL against page origin", async () => {
      mockFetchWithHTML(`
        <html><head>
          <meta property="og:image" content="/images/hero.jpg" />
        </head><body></body></html>
      `);
      const res = await POST(makeRequest({ url: "https://blog.example.com/post/1" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://blog.example.com/images/hero.jpg");
    });

    it("resolves protocol-relative og:image URL", async () => {
      mockFetchWithHTML(`
        <html><head>
          <meta property="og:image" content="//cdn.example.com/img.jpg" />
        </head><body></body></html>
      `);
      const res = await POST(makeRequest({ url: "https://example.com/page" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://cdn.example.com/img.jpg");
    });

    it("resolves relative path og:image URL", async () => {
      mockFetchWithHTML(`
        <html><head>
          <meta property="og:image" content="assets/og.png" />
        </head><body></body></html>
      `);
      const res = await POST(makeRequest({ url: "https://example.com/blog/post" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://example.com/blog/assets/og.png");
    });

    it("returns null when no og:image tag exists", async () => {
      mockFetchWithHTML(`
        <html><head><title>No OG</title></head><body></body></html>
      `);
      const res = await POST(makeRequest({ url: "https://example.com/plain" }));
      const data = await res.json();
      expect(data.imageUrl).toBeNull();
    });

    it("handles single-quoted attributes", async () => {
      mockFetchWithHTML(`
        <html><head>
          <meta property='og:image' content='https://example.com/single.jpg' />
        </head><body></body></html>
      `);
      const res = await POST(makeRequest({ url: "https://example.com/page" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://example.com/single.jpg");
    });

    it("handles mixed attribute quoting", async () => {
      mockFetchWithHTML(`
        <html><head>
          <meta property="og:image" content='https://example.com/mixed.jpg' />
        </head><body></body></html>
      `);
      const res = await POST(makeRequest({ url: "https://example.com/page" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://example.com/mixed.jpg");
    });

    it("returns null for non-200 HTTP response", async () => {
      mockFetchWithHTML("", 404);
      const res = await POST(makeRequest({ url: "https://example.com/missing" }));
      const data = await res.json();
      expect(data.imageUrl).toBeNull();
    });

    it("returns null when response has no body", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response);
      const res = await POST(makeRequest({ url: "https://example.com/nobody" }));
      const data = await res.json();
      expect(data.imageUrl).toBeNull();
    });

    it("returns null when fetch throws (network error)", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
      const res = await POST(makeRequest({ url: "https://unreachable.example.com/" }));
      const data = await res.json();
      expect(data.imageUrl).toBeNull();
    });
  });

  describe("boundary conditions", () => {
    it("stops reading at </head> tag for efficiency", async () => {
      // Head has og:image, body has a different one — should use head's
      const html = `<html><head><meta property="og:image" content="https://example.com/head.jpg" /></head><body><meta property="og:image" content="https://example.com/body.jpg" /></body></html>`;
      const encoder = new TextEncoder();
      const chunks = [encoder.encode(html)];
      let chunkIdx = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (chunkIdx < chunks.length) {
                return { done: false, value: chunks[chunkIdx++] };
              }
              return { done: true, value: undefined };
            },
            cancel: async () => {},
          }),
        },
      } as unknown as Response);
      const res = await POST(makeRequest({ url: "https://example.com/page" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://example.com/head.jpg");
    });

    it("handles chunked reading (og:image split across chunks)", async () => {
      const part1 = '<html><head><meta property="og:image" ';
      const part2 = 'content="https://example.com/chunked.jpg" /></head>';
      const encoder = new TextEncoder();
      const chunks = [encoder.encode(part1), encoder.encode(part2)];
      let chunkIdx = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (chunkIdx < chunks.length) {
                return { done: false, value: chunks[chunkIdx++] };
              }
              return { done: true, value: undefined };
            },
            cancel: async () => {},
          }),
        },
      } as unknown as Response);
      const res = await POST(makeRequest({ url: "https://example.com/chunked" }));
      const data = await res.json();
      expect(data.imageUrl).toBe("https://example.com/chunked.jpg");
    });

    it("respects 50KB max read limit", async () => {
      // Create a large head with og:image after 50KB — should not be found
      const bigPadding = "x".repeat(55_000);
      const html = `<html><head>${bigPadding}<meta property="og:image" content="https://example.com/late.jpg" /></head>`;
      const encoder = new TextEncoder();
      // Deliver in chunks of ~10KB
      const encoded = encoder.encode(html);
      const chunkSize = 10_000;
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < encoded.length; i += chunkSize) {
        chunks.push(encoded.slice(i, i + chunkSize));
      }
      let chunkIdx = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (chunkIdx < chunks.length) {
                return { done: false, value: chunks[chunkIdx++] };
              }
              return { done: true, value: undefined };
            },
            cancel: async () => {},
          }),
        },
      } as unknown as Response);
      const res = await POST(makeRequest({ url: "https://example.com/large" }));
      const data = await res.json();
      // The og:image is after 55KB, so it should be missed due to 50KB limit
      expect(data.imageUrl).toBeNull();
    });

    it("handles URL with special characters in og:image", async () => {
      const encoder = new TextEncoder();
      const html = `<html><head><meta property="og:image" content="https://example.com/img?w=800&amp;h=600" /></head>`;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: false, value: encoder.encode(html) }),
            cancel: async () => {},
          }),
        },
      } as unknown as Response);
      // The regex captures `&amp;` literally — this is the raw HTML entity
      const res = await POST(makeRequest({ url: "https://example.com/page" }));
      const data = await res.json();
      expect(data.imageUrl).toContain("example.com/img");
    });
  });
});
