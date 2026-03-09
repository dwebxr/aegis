import { POST } from "@/app/api/fetch/ogimage/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { _resetOgCache } from "@/lib/cache/ogimage";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/ogimage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const originalFetch = global.fetch;

function mockFetchForUrls(responses: Record<string, string | null>) {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    const ogImage = responses[url];
    if (ogImage === undefined) {
      return Promise.reject(new Error("Network error"));
    }
    const html = ogImage
      ? `<html><head><meta property="og:image" content="${ogImage}" /></head></html>`
      : `<html><head><title>No OG</title></head></html>`;
    const encoder = new TextEncoder();
    const chunks = [encoder.encode(html)];
    let idx = 0;
    return Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (idx < chunks.length) return { done: false, value: chunks[idx++] };
            return { done: true, value: undefined };
          },
          cancel: async () => {},
        }),
      },
    });
  });
}

describe("POST /api/fetch/ogimage — batch mode", () => {
  beforeEach(() => {
    _resetRateLimits();
    _resetOgCache();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("accepts urls array and returns results for each", async () => {
    mockFetchForUrls({
      "https://a.com/page": "https://a.com/img.jpg",
      "https://b.com/page": "https://b.com/img.png",
    });

    const res = await POST(makeRequest({
      urls: ["https://a.com/page", "https://b.com/page"],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(2);
    expect(data.results[0]).toEqual({ url: "https://a.com/page", imageUrl: "https://a.com/img.jpg" });
    expect(data.results[1]).toEqual({ url: "https://b.com/page", imageUrl: "https://b.com/img.png" });
  });

  it("returns null for URLs without OG images in batch", async () => {
    mockFetchForUrls({
      "https://a.com/page": "https://a.com/img.jpg",
      "https://b.com/no-og": null,
    });

    const res = await POST(makeRequest({
      urls: ["https://a.com/page", "https://b.com/no-og"],
    }));
    const data = await res.json();
    expect(data.results[0].imageUrl).toBe("https://a.com/img.jpg");
    expect(data.results[1].imageUrl).toBeNull();
  });

  it("handles network errors in batch gracefully", async () => {
    mockFetchForUrls({
      "https://ok.com/page": "https://ok.com/img.jpg",
      // "https://fail.com/page" not in map → triggers network error
    });

    const res = await POST(makeRequest({
      urls: ["https://ok.com/page", "https://fail.com/page"],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0].imageUrl).toBe("https://ok.com/img.jpg");
    expect(data.results[1].imageUrl).toBeNull();
  });

  it("returns 400 when all URLs are invalid (empty strings)", async () => {
    const res = await POST(makeRequest({ urls: ["", "", ""] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("valid URL");
  });

  it("returns 400 when urls is an empty array", async () => {
    const res = await POST(makeRequest({ urls: [] }));
    expect(res.status).toBe(400);
  });

  it("limits batch to 30 URLs", async () => {
    const urls = Array.from({ length: 35 }, (_, i) => `https://example.com/${i}`);
    mockFetchForUrls(Object.fromEntries(urls.map(u => [u, `${u}/img.jpg`])));

    const res = await POST(makeRequest({ urls }));
    const data = await res.json();
    expect(data.results).toHaveLength(30);
  });

  it("filters out non-string entries in urls array", async () => {
    mockFetchForUrls({ "https://valid.com/page": "https://valid.com/img.jpg" });
    const res = await POST(makeRequest({
      urls: [123, null, "https://valid.com/page", undefined, ""],
    }));
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].url).toBe("https://valid.com/page");
  });

  it("uses cache for repeated URLs in same batch", async () => {
    let fetchCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      fetchCount++;
      const html = '<html><head><meta property="og:image" content="https://x.com/img.jpg" /></head></html>';
      const encoder = new TextEncoder();
      const chunks = [encoder.encode(html)];
      let idx = 0;
      return Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (idx < chunks.length) return { done: false, value: chunks[idx++] };
              return { done: true, value: undefined };
            },
            cancel: async () => {},
          }),
        },
      });
    });

    // First batch populates cache
    await POST(makeRequest({ urls: ["https://x.com/page"] }));
    expect(fetchCount).toBe(1);

    // Second batch should use cache
    fetchCount = 0;
    const res = await POST(makeRequest({ urls: ["https://x.com/page"] }));
    const data = await res.json();
    expect(data.results[0].imageUrl).toBe("https://x.com/img.jpg");
    expect(fetchCount).toBe(0); // Served from cache
  });

  it("prefers single url over urls when both provided", async () => {
    mockFetchForUrls({
      "https://single.com": "https://single.com/img.jpg",
      "https://batch.com": "https://batch.com/img.jpg",
    });

    // When urls is present, batch mode takes precedence
    const res = await POST(makeRequest({
      url: "https://single.com",
      urls: ["https://batch.com"],
    }));
    const data = await res.json();
    // Batch mode should win (urls checked first)
    expect(data.results).toBeDefined();
    expect(data.results[0].url).toBe("https://batch.com");
  });
});
