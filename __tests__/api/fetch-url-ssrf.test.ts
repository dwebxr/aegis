/**
 * SSRF integration test for /api/fetch/url — codex finding #5.
 *
 * Pre-fix: route called `extract(url)` directly, which lets article-extractor
 * fetch the URL itself (with its own redirect handling, bypassing
 * blockPrivateUrl on follow-up hops).
 *
 * Post-fix: route uses `safeFetch(url)` then `extractFromHtml(html)`. SSRF
 * protection runs on every hop, content-type is validated, body size is
 * capped, and the final fetched HTML is fed to the extractor as-is.
 *
 * This test exercises the REAL safeFetch + url filter against a mocked
 * global fetch — no jest.mock on lib/utils/url. That way regressions to
 * the route's defense-in-depth structure (skipping safeFetch, bypassing
 * size cap, etc.) get caught.
 */
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { _resetUrlCache } from "@/lib/cache/urlExtract";

// Mock article-extractor to deterministic output — we're not testing parsing.
const mockExtractFromHtml = jest.fn();
jest.mock("@extractus/article-extractor", () => ({
  extractFromHtml: (...args: unknown[]) => mockExtractFromHtml(...args),
}));

// Mock DNS so resolveAndCheckHost returns predictable IPs without hitting real DNS.
const mockLookup = jest.fn();
jest.mock("node:dns/promises", () => ({
  __esModule: true,
  lookup: (...args: unknown[]) => mockLookup(...args),
}));
jest.mock("node:net", () => ({
  __esModule: true,
  // Default: not an IP literal — flow through to DNS path.
  isIP: () => 0,
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { POST } from "@/app/api/fetch/url/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fetchResponse(opts: {
  status?: number;
  body?: string;
  bytes?: Uint8Array;
  contentType?: string;
  location?: string;
}): Response {
  const status = opts.status ?? 200;
  const headers = new Headers();
  if (opts.contentType) headers.set("content-type", opts.contentType);
  if (opts.location) headers.set("location", opts.location);
  const buffer = opts.bytes ?? new TextEncoder().encode(opts.body ?? "<html><body>article</body></html>");
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  } as unknown as Response;
}

const VALID_ARTICLE = {
  title: "Hello",
  author: "Author",
  content: "<p>" + "x".repeat(200) + "</p>",
  description: "desc",
  published: "2024-01-01",
  image: "https://example.com/i.jpg",
};

beforeEach(() => {
  _resetRateLimits();
  _resetUrlCache();
  mockExtractFromHtml.mockReset();
  mockLookup.mockReset();
  mockFetch.mockReset();
});

describe("POST /api/fetch/url — SSRF defense", () => {
  it("blocks URL whose hostname resolves to a private IP (DNS rebinding)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const res = await POST(makeRequest({ url: "https://rebind.attacker.dev/" }));

    expect(res.status).toBe(502); // safeFetch throws → route catches → 502
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockExtractFromHtml).not.toHaveBeenCalled();
  });

  it("blocks an SSRF that hides behind a redirect", async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])           // initial OK
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);          // redirect target private
    mockFetch.mockResolvedValueOnce(
      fetchResponse({ status: 302, location: "https://internal.attacker.dev/" }),
    );

    const res = await POST(makeRequest({ url: "https://innocent.example.com/" }));
    expect(res.status).toBe(502);
    expect(mockExtractFromHtml).not.toHaveBeenCalled();
  });

  it("rejects non-HTML content-type (won't pass blob to extractor)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    mockFetch.mockResolvedValueOnce(
      fetchResponse({ status: 200, contentType: "application/octet-stream", body: "binary" }),
    );

    const res = await POST(makeRequest({ url: "https://good.example.com/" }));
    expect(res.status).toBe(502);
    expect(mockExtractFromHtml).not.toHaveBeenCalled();
  });

  it("rejects oversized HTML before passing to extractor (5MB cap)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    const huge = new Uint8Array(6_000_000); // 6MB > 5MB cap
    mockFetch.mockResolvedValueOnce(
      fetchResponse({ status: 200, contentType: "text/html", bytes: huge }),
    );

    const res = await POST(makeRequest({ url: "https://huge.example.com/" }));
    expect(res.status).toBe(502);
    expect(mockExtractFromHtml).not.toHaveBeenCalled();
  });

  it("passes fetched HTML body to extractFromHtml (not the URL)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    const html = "<html><body><article>Body content here long enough.</article></body></html>";
    mockFetch.mockResolvedValueOnce(
      fetchResponse({ status: 200, contentType: "text/html", body: html }),
    );
    mockExtractFromHtml.mockResolvedValueOnce(VALID_ARTICLE);

    const res = await POST(makeRequest({ url: "https://good.example.com/post" }));
    expect(res.status).toBe(200);
    // First arg is the fetched HTML; second arg is the URL for relative-link resolution.
    expect(mockExtractFromHtml).toHaveBeenCalledTimes(1);
    const [passedHtml, passedUrl] = mockExtractFromHtml.mock.calls[0];
    expect(passedHtml).toBe(html);
    expect(passedUrl).toBe("https://good.example.com/post");
  });

  it("returns extracted data shape (verifies data inspection, not just status)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    mockFetch.mockResolvedValueOnce(fetchResponse({ status: 200, contentType: "text/html" }));
    mockExtractFromHtml.mockResolvedValueOnce({
      title: "T",
      author: "A",
      content: "<p>" + "y".repeat(200) + "</p>",
      description: "D",
      published: "2024-02",
      image: "https://example.com/x.jpg",
    });

    const res = await POST(makeRequest({ url: "https://good.example.com/post" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("T");
    expect(data.author).toBe("A");
    expect(data.source).toBe("good.example.com");
    expect(data.imageUrl).toBe("https://example.com/x.jpg");
    expect(data.content).toMatch(/^y+$/); // HTML stripped to text
  });

  it("rejects upstream 4xx response (502 to client)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
    mockFetch.mockResolvedValueOnce(fetchResponse({ status: 404, contentType: "text/html" }));

    const res = await POST(makeRequest({ url: "https://gone.example.com/" }));
    expect(res.status).toBe(502);
  });

  it("rejects javascript: URLs at the validator layer (never reaches safeFetch)", async () => {
    const res = await POST(makeRequest({ url: "javascript:alert(1)" }));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("batch mode applies SSRF check to every URL", async () => {
    // First URL resolves OK; second resolves private.
    mockLookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    mockFetch.mockResolvedValueOnce(fetchResponse({ status: 200, contentType: "text/html" }));
    mockExtractFromHtml.mockResolvedValueOnce(VALID_ARTICLE);

    const res = await POST(
      makeRequest({ urls: ["https://good.example.com/", "https://meta-attacker.dev/"] }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(2);
    expect(data.results[0].title).toBe("Hello");
    expect(data.results[1].error).toBeDefined();
  });
});
