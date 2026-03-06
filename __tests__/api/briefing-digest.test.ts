import { POST } from "@/app/api/briefing/digest/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const mockFetch = jest.fn();
const originalFetch = global.fetch;

jest.mock("@/lib/api/dailyBudget", () => ({
  withinDailyBudget: jest.fn(async () => true),
  recordApiCall: jest.fn(async () => {}),
}));

function makeRequest(body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/briefing/digest", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const sampleArticles = [
  { title: "AI Advances", text: "New developments in artificial intelligence", score: 8.5, topics: ["ai"] },
  { title: "Climate Report", text: "Latest climate change findings", score: 7.2, topics: ["climate"] },
];

beforeEach(() => {
  _resetRateLimits();
  mockFetch.mockReset();
  global.fetch = mockFetch;
  process.env.ANTHROPIC_API_KEY = "sk-ant-api03-testkey";
});

afterAll(() => {
  global.fetch = originalFetch;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("POST /api/briefing/digest", () => {
  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost:3000/api/briefing/digest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when articles missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("articles");
  });

  it("returns 400 for empty articles array", async () => {
    const res = await POST(makeRequest({ articles: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 503 when no API key available", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(makeRequest({ articles: sampleArticles }));
    expect(res.status).toBe(503);
  });

  it("returns digest on successful Anthropic response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: "AI and climate developments highlight key trends." }],
      }),
    });
    const res = await POST(makeRequest({ articles: sampleArticles }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.digest).toBe("AI and climate developments highlight key trends.");
  });

  it("returns 502 and logs error when Anthropic returns non-OK", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    const spy = jest.spyOn(console, "error").mockImplementation();
    const res = await POST(makeRequest({ articles: sampleArticles }));
    expect(res.status).toBe(502);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("429"));
    spy.mockRestore();
  });

  it("returns 502 when Anthropic throws network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    const spy = jest.spyOn(console, "error").mockImplementation();
    const res = await POST(makeRequest({ articles: sampleArticles }));
    expect(res.status).toBe(502);
    spy.mockRestore();
  });

  it("caps articles to 5", async () => {
    const manyArticles = Array.from({ length: 10 }, (_, i) => ({
      title: `Article ${i}`, text: `Content ${i}`, score: 5, topics: ["test"],
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: "digest" }] }),
    });
    await POST(makeRequest({ articles: manyArticles }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Prompt should only contain 5 articles (numbered 1-5)
    expect(body.messages[0].content).toContain("5.");
    expect(body.messages[0].content).not.toContain("6.");
  });

  it("uses user API key when provided via header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: "digest" }] }),
    });
    await POST(makeRequest({ articles: sampleArticles }, { "x-user-api-key": "sk-ant-user-key" }));
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["x-api-key"]).toBe("sk-ant-user-key");
  });

  it("returns empty string when Anthropic returns empty content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [] }),
    });
    const res = await POST(makeRequest({ articles: sampleArticles }));
    const data = await res.json();
    expect(data.digest).toBe("");
  });
});
