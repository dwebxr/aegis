import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

// Mock @extractus/article-extractor to test code paths beyond input validation
const mockExtract = jest.fn();
jest.mock("@extractus/article-extractor", () => ({
  extract: (...args: unknown[]) => mockExtract(...args),
}));

import { POST } from "@/app/api/fetch/url/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/url — extraction", () => {
  beforeEach(() => {
    _resetRateLimits();
    mockExtract.mockReset();
  });

  describe("successful extraction", () => {
    it("returns extracted article data", async () => {
      mockExtract.mockResolvedValueOnce({
        title: "Test Article",
        author: "Jane Doe",
        content: "<p>This is a long enough article content that exceeds the minimum character threshold for evaluation.</p>",
        description: "A test article",
        published: "2024-01-15T00:00:00Z",
        image: "https://example.com/image.jpg",
      });

      const res = await POST(makeRequest({ url: "https://example.com/article" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.title).toBe("Test Article");
      expect(data.author).toBe("Jane Doe");
      expect(data.description).toBe("A test article");
      expect(data.source).toBe("example.com");
      expect(data.imageUrl).toBe("https://example.com/image.jpg");
      // HTML tags stripped
      expect(data.content).not.toContain("<p>");
    });

    it("strips HTML tags and normalizes whitespace", async () => {
      mockExtract.mockResolvedValueOnce({
        title: "HTML Test",
        content: "<div>  <p>First paragraph with some important details about the topic at hand.</p>   <p>Second   paragraph continues with additional context and analysis.</p>  </div>",
      });

      const res = await POST(makeRequest({ url: "https://example.com/html" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).not.toContain("<");
      expect(data.content).not.toContain(">");
      // Multiple spaces collapsed
      expect(data.content).not.toMatch(/  /);
    });

    it("truncates content at 10000 characters", async () => {
      const longContent = "A".repeat(15000);
      mockExtract.mockResolvedValueOnce({
        title: "Long",
        content: longContent,
      });

      const res = await POST(makeRequest({ url: "https://example.com/long" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content.length).toBe(10000);
    });

    it("defaults author to 'Unknown' when not provided", async () => {
      mockExtract.mockResolvedValueOnce({
        title: "No Author",
        content: "Sufficient content length for the test to pass the minimum threshold of fifty characters easily.",
      });

      const res = await POST(makeRequest({ url: "https://example.com/noauthor" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.author).toBe("Unknown");
    });

    it("extracts hostname as source", async () => {
      mockExtract.mockResolvedValueOnce({
        title: "Test",
        content: "Content that is sufficiently long enough to pass the minimum threshold for evaluation.",
      });

      const res = await POST(makeRequest({ url: "https://blog.example.co.jp/posts/123" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.source).toBe("blog.example.co.jp");
    });

    it("handles missing optional fields gracefully", async () => {
      mockExtract.mockResolvedValueOnce({
        content: "Minimal content that is long enough to pass the fifty character minimum threshold.",
      });

      const res = await POST(makeRequest({ url: "https://example.com/minimal" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.title).toBe("");
      expect(data.description).toBe("");
      expect(data.publishedDate).toBe("");
      expect(data.imageUrl).toBeUndefined();
    });
  });

  describe("extraction failures", () => {
    it("returns 502 when extract() throws (unreachable URL)", async () => {
      mockExtract.mockRejectedValueOnce(new Error("ENOTFOUND"));
      const res = await POST(makeRequest({ url: "https://nonexistent.example.com" }));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("Could not reach");
    });

    it("returns 422 when extract() returns null", async () => {
      mockExtract.mockResolvedValueOnce(null);
      const res = await POST(makeRequest({ url: "https://example.com/paywalled" }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain("no parseable content");
    });

    it("returns 422 when article has no content", async () => {
      mockExtract.mockResolvedValueOnce({ title: "Empty", content: "" });
      const res = await POST(makeRequest({ url: "https://example.com/empty" }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain("no article text");
    });

    it("returns 422 when extracted text is too short (under 50 chars)", async () => {
      mockExtract.mockResolvedValueOnce({ title: "Short", content: "Hello world" });
      const res = await POST(makeRequest({ url: "https://example.com/short" }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain("too short");
    });

    it("returns 422 when content is only HTML tags (text is empty after stripping)", async () => {
      mockExtract.mockResolvedValueOnce({ title: "Tags Only", content: "<br><br><hr>" });
      const res = await POST(makeRequest({ url: "https://example.com/tags" }));
      expect(res.status).toBe(422);
    });
  });

  describe("SSRF protection edge cases", () => {
    it("blocks CGNAT range (100.64.x.x)", async () => {
      const res = await POST(makeRequest({ url: "http://100.64.0.1/admin" }));
      expect(res.status).toBe(400);
    });

    it("blocks 0.0.0.0", async () => {
      const res = await POST(makeRequest({ url: "http://0.0.0.0/" }));
      expect(res.status).toBe(400);
    });

    it("blocks 172.16.x.x private range", async () => {
      const res = await POST(makeRequest({ url: "http://172.16.0.1/internal" }));
      expect(res.status).toBe(400);
    });

    it("blocks 192.168.x.x private range", async () => {
      const res = await POST(makeRequest({ url: "http://192.168.1.1/router" }));
      expect(res.status).toBe(400);
    });

    it("blocks link-local (169.254.x.x)", async () => {
      const res = await POST(makeRequest({ url: "http://169.254.0.1/metadata" }));
      expect(res.status).toBe(400);
    });
  });
});
