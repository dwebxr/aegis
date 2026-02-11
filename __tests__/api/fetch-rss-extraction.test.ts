/**
 * Tests for RSS route image extraction and item building.
 * Uses mocked fetch to feed specific RSS XML through the handler,
 * testing extractAttr/extractImage/buildItems behavior end-to-end.
 */
import { POST } from "@/app/api/fetch/rss/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const origFetch = global.fetch;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/rss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rssXml(items: string, feedTitle = "Test Feed"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${feedTitle}</title>
    ${items}
  </channel>
</rss>`;
}

describe("POST /api/fetch/rss — item extraction", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it("extracts title, link, author, and content from RSS items", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(`
        <item>
          <title>Test Article</title>
          <link>https://example.com/article</link>
          <dc:creator>John Doe</dc:creator>
          <description>This is test content about AI research.</description>
        </item>
      `),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("Test Article");
    expect(data.items[0].link).toBe("https://example.com/article");
    expect(data.items[0].content).toContain("test content");
  });

  it("extracts image from enclosure with image type", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(`
        <item>
          <title>With Enclosure Image</title>
          <link>https://example.com/1</link>
          <description>Content</description>
          <enclosure url="https://cdn.example.com/photo.jpg" type="image/jpeg" />
        </item>
      `),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[0].imageUrl).toBe("https://cdn.example.com/photo.jpg");
  });

  it("does NOT extract enclosure with non-image type", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(`
        <item>
          <title>Audio Enclosure</title>
          <link>https://example.com/1</link>
          <description>Content</description>
          <enclosure url="https://cdn.example.com/audio.mp3" type="audio/mpeg" />
        </item>
      `),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[0].imageUrl).toBeUndefined();
  });

  it("extracts image from media:thumbnail", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(`
        <item>
          <title>With Media Thumbnail</title>
          <link>https://example.com/1</link>
          <description>Content</description>
          <media:thumbnail url="https://cdn.example.com/thumb.jpg" />
        </item>
      `),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[0].imageUrl).toBe("https://cdn.example.com/thumb.jpg");
  });

  it("extracts image from <img> tag in content", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(`
        <item>
          <title>Content With Image</title>
          <link>https://example.com/1</link>
          <description><![CDATA[<p>Text <img src="https://cdn.example.com/inline.png" alt="photo"> more text</p>]]></description>
        </item>
      `),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[0].imageUrl).toBe("https://cdn.example.com/inline.png");
  });

  it("strips HTML tags from content", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(`
        <item>
          <title>HTML Content</title>
          <link>https://example.com/1</link>
          <description><![CDATA[<p>This is <strong>bold</strong> and <em>italic</em> text.</p>]]></description>
        </item>
      `),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[0].content).toContain("This is bold and italic text");
    expect(data.items[0].content).not.toContain("<strong>");
    expect(data.items[0].content).not.toContain("<em>");
  });

  it("respects limit parameter", async () => {
    const items = Array.from({ length: 10 }, (_, i) => `
      <item>
        <title>Item ${i + 1}</title>
        <link>https://example.com/${i + 1}</link>
        <description>Content ${i + 1}</description>
      </item>
    `).join("");

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(items),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml", limit: 3 }));
    const data = await res.json();
    expect(data.items).toHaveLength(3);
  });

  it("caps limit at 50 even if requested higher", async () => {
    const items = Array.from({ length: 60 }, (_, i) => `
      <item>
        <title>Item ${i + 1}</title>
        <link>https://example.com/${i + 1}</link>
        <description>Content ${i + 1}</description>
      </item>
    `).join("");

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(items),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml", limit: 100 }));
    const data = await res.json();
    expect(data.items.length).toBeLessThanOrEqual(50);
  });

  it("returns feedTitle from the feed", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml("<item><title>X</title></item>", "My Cool Feed"),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.feedTitle).toBe("My Cool Feed");
  });

  it("truncates content at 5000 characters", async () => {
    const longContent = "x".repeat(10000);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(`
        <item>
          <title>Long Content</title>
          <link>https://example.com/1</link>
          <description>${longContent}</description>
        </item>
      `),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items[0].content.length).toBeLessThanOrEqual(5000);
  });

  it("handles empty feed (no items)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => rssXml(""),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    const data = await res.json();
    expect(data.items).toEqual([]);
  });

  it("returns 502 for HTTP 500 from feed server", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(502);
  });

  it("returns 502 for HTTP 403 from feed server", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(502);
  });

  it("returns 422 for invalid XML content", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "this is not XML",
    });

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(422);
  });

  it("returns 502 for network error (ECONNREFUSED)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("reach");
  });

  it("returns 502 for DNS failure (ENOTFOUND)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ENOTFOUND"));

    const res = await POST(makeRequest({ feedUrl: "https://example.com/feed.xml" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("reach");
  });
});
