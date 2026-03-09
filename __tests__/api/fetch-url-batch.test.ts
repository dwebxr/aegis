import { POST } from "@/app/api/fetch/url/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { _resetUrlCache } from "@/lib/cache/urlExtract";

jest.mock("@extractus/article-extractor", () => ({
  extract: jest.fn(),
}));

import { extract } from "@extractus/article-extractor";

const mockExtract = extract as jest.MockedFunction<typeof extract>;

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeArticle(overrides: Record<string, unknown> = {}) {
  return {
    title: "Test Article",
    author: "Author",
    content: "<p>" + "Real content here. ".repeat(20) + "</p>",
    description: "A test article",
    published: "2025-01-01",
    image: "https://example.com/img.jpg",
    ...overrides,
  };
}

describe("POST /api/fetch/url — batch mode", () => {
  beforeEach(() => {
    _resetRateLimits();
    _resetUrlCache();
    mockExtract.mockReset();
  });

  it("accepts urls array and returns results for each", async () => {
    mockExtract.mockResolvedValueOnce(fakeArticle({ title: "Article A" }));
    mockExtract.mockResolvedValueOnce(fakeArticle({ title: "Article B" }));

    const res = await POST(makeRequest({
      urls: ["https://a.com/page", "https://b.com/page"],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(2);
    expect(data.results[0].url).toBe("https://a.com/page");
    expect(data.results[0].title).toBe("Article A");
    expect(data.results[1].url).toBe("https://b.com/page");
    expect(data.results[1].title).toBe("Article B");
  });

  it("returns error objects for failed extractions in batch", async () => {
    mockExtract.mockResolvedValueOnce(fakeArticle());
    mockExtract.mockRejectedValueOnce(new Error("Network timeout"));

    const res = await POST(makeRequest({
      urls: ["https://ok.com/page", "https://fail.com/page"],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0].title).toBe("Test Article");
    expect(data.results[1].error).toBeDefined();
    expect(data.results[1].url).toBe("https://fail.com/page");
  });

  it("returns 400 when urls is an empty array", async () => {
    const res = await POST(makeRequest({ urls: [] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("URL");
  });

  it("returns 400 when all urls are invalid (empty strings)", async () => {
    const res = await POST(makeRequest({ urls: ["", "", ""] }));
    expect(res.status).toBe(400);
  });

  it("filters out non-string entries in urls array", async () => {
    mockExtract.mockResolvedValueOnce(fakeArticle({ title: "Valid" }));

    const res = await POST(makeRequest({
      urls: [123, null, "https://valid.com/page", undefined, ""],
    }));
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].url).toBe("https://valid.com/page");
    expect(data.results[0].title).toBe("Valid");
  });

  it("limits batch to 10 URLs", async () => {
    const urls = Array.from({ length: 15 }, (_, i) => `https://example.com/${i}`);
    mockExtract.mockResolvedValue(fakeArticle());

    const res = await POST(makeRequest({ urls }));
    const data = await res.json();
    expect(data.results).toHaveLength(10);
  });

  it("returns error for private/SSRF URLs in batch", async () => {
    mockExtract.mockResolvedValueOnce(fakeArticle());

    const res = await POST(makeRequest({
      urls: ["https://public.com/page", "http://127.0.0.1/internal"],
    }));
    const data = await res.json();
    expect(data.results).toHaveLength(2);
    expect(data.results[0].title).toBe("Test Article");
    expect(data.results[1].error).toBeDefined();
  });

  it("returns error for URLs with no parseable content", async () => {
    mockExtract.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({
      urls: ["https://empty.com/page"],
    }));
    const data = await res.json();
    expect(data.results[0].error).toContain("no parseable content");
  });

  it("returns error for articles with content too short", async () => {
    mockExtract.mockResolvedValueOnce(fakeArticle({ content: "<p>Short</p>" }));

    const res = await POST(makeRequest({
      urls: ["https://short.com/page"],
    }));
    const data = await res.json();
    expect(data.results[0].error).toContain("too short");
  });

  it("uses cache for repeated URLs across batches", async () => {
    mockExtract.mockResolvedValueOnce(fakeArticle({ title: "Cached" }));

    // First batch populates cache
    await POST(makeRequest({ urls: ["https://cached.com/page"] }));
    expect(mockExtract).toHaveBeenCalledTimes(1);

    // Second batch should use cache
    const res = await POST(makeRequest({ urls: ["https://cached.com/page"] }));
    const data = await res.json();
    expect(data.results[0].title).toBe("Cached");
    expect(mockExtract).toHaveBeenCalledTimes(1); // No additional calls
  });

  it("handles Promise.allSettled rejections gracefully", async () => {
    mockExtract.mockRejectedValue(new Error("Total failure"));

    const res = await POST(makeRequest({
      urls: ["https://a.com", "https://b.com"],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(2);
    expect(data.results[0].error).toBeDefined();
    expect(data.results[1].error).toBeDefined();
  });

  it("prefers urls over url when both provided", async () => {
    mockExtract.mockResolvedValue(fakeArticle());

    const res = await POST(makeRequest({
      url: "https://single.com",
      urls: ["https://batch.com/page"],
    }));
    const data = await res.json();
    // Batch mode should win
    expect(data.results).toBeDefined();
    expect(data.results[0].url).toBe("https://batch.com/page");
  });
});
