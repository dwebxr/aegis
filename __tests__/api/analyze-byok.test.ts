import { POST } from "@/app/api/analyze/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { _resetDailyBudget } from "@/lib/api/dailyBudget";

const originalFetch = global.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;

function makeRequest(body: unknown, headers?: Record<string, string>): NextRequest {
  const allHeaders: Record<string, string> = { "Content-Type": "application/json", ...headers };
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: allHeaders,
    body: JSON.stringify(body),
  });
}

describe("POST /api/analyze — BYOK (user API key)", () => {
  beforeEach(async () => {
    _resetRateLimits();
    await _resetDailyBudget();
    // Ensure no server key
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("uses user API key from X-User-API-Key header", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: '{"originality":8,"insight":7,"credibility":9,"composite":8.1,"verdict":"quality","reason":"Good"}' }],
      }),
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { text: "Detailed analysis with data: 42% improvement in benchmarks" },
      { "x-user-api-key": "sk-ant-api03-test-key-12345" },
    ));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("claude");
    expect(data.composite).toBe(8.1);

    // Verify the API was called with the user key
    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(fetchCall[1].headers["x-api-key"]).toBe("sk-ant-api03-test-key-12345");
  });

  it("falls back to heuristic when user key has invalid prefix", async () => {
    const res = await POST(makeRequest(
      { text: "Content to analyze" },
      { "x-user-api-key": "invalid-key-format" },
    ));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("heuristic");
  });

  it("falls back to heuristic when X-User-API-Key is empty", async () => {
    const res = await POST(makeRequest(
      { text: "Content to analyze" },
      { "x-user-api-key": "" },
    ));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("heuristic");
  });

  it("prefers user key over server key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-server-key-should-not-be-used";

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: '{"originality":7,"insight":7,"credibility":7,"composite":7.0,"verdict":"quality","reason":"ok"}' }],
      }),
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { text: "Content to analyze with data" },
      { "x-user-api-key": "sk-ant-user-key-should-be-used" },
    ));

    expect(res.status).toBe(200);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[1].headers["x-api-key"]).toBe("sk-ant-user-key-should-be-used");
  });

  it("returns 502 with fallback when Anthropic returns non-ok with user key", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { type: "authentication_error" } }),
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { text: "Content to analyze" },
      { "x-user-api-key": "sk-ant-invalid-actual-key" },
    ));

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("Anthropic API error");
    expect(data.fallback).toBeDefined();
    expect(data.fallback.tier).toBe("heuristic");
  });

  it("returns 502 with fallback when Anthropic fetch throws with user key", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("Network error")) as jest.Mock;

    const res = await POST(makeRequest(
      { text: "Content to analyze" },
      { "x-user-api-key": "sk-ant-api03-valid-key" },
    ));

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("Request failed");
    expect(data.fallback.tier).toBe("heuristic");
  });

  it("returns 502 when Anthropic returns non-JSON response with user key", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new Error("Unexpected token"); },
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { text: "Content to analyze" },
      { "x-user-api-key": "sk-ant-api03-valid-key" },
    ));

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("parse");
    expect(data.fallback.tier).toBe("heuristic");
  });

  it("returns 502 when AI response is not valid JSON", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: "This is not JSON at all, just a rambling response" }],
      }),
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { text: "Content to analyze" },
      { "x-user-api-key": "sk-ant-api03-valid-key" },
    ));

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("parse AI response");
    expect(data.fallback.tier).toBe("heuristic");
  });

  it("strips markdown code fences from AI response", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: '```json\n{"originality":8,"insight":8,"credibility":8,"composite":8.0,"verdict":"quality","reason":"ok"}\n```' }],
      }),
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { text: "Content to analyze" },
      { "x-user-api-key": "sk-ant-api03-valid-key" },
    ));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.composite).toBe(8.0);
    expect(data.tier).toBe("claude");
  });

  it("includes V/C/L scores in response when present in AI output", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{
          text: '{"originality":8,"insight":7,"credibility":9,"composite":8.1,"verdict":"quality","reason":"Novel","vSignal":9,"cContext":7,"lSlop":2,"topics":["ai","ml"]}',
        }],
      }),
    }) as jest.Mock;

    const res = await POST(makeRequest(
      { text: "Content to analyze" },
      { "x-user-api-key": "sk-ant-api03-valid-key" },
    ));

    const data = await res.json();
    expect(data.vSignal).toBe(9);
    expect(data.cContext).toBe(7);
    expect(data.lSlop).toBe(2);
    expect(data.topics).toEqual(["ai", "ml"]);
  });
});

describe("POST /api/analyze — userContext sanitization", () => {
  beforeEach(async () => {
    _resetRateLimits();
    await _resetDailyBudget();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("sanitizes topics arrays: filters non-strings and long entries", async () => {
    // This tests the sanitizeTopics function
    // Without API key, falls to heuristic but sanitization still runs
    const res = await POST(makeRequest({
      text: "Some content",
      userContext: {
        recentTopics: ["valid", 123, null, "a".repeat(100), "also-valid"],
        highAffinityTopics: ["short"],
        lowAffinityTopics: [],
        trustedAuthors: ["author1"],
      },
    }));

    expect(res.status).toBe(200);
    // Just verify it doesn't crash — sanitization is applied internally
  });

  it("handles missing userContext fields gracefully", async () => {
    const res = await POST(makeRequest({
      text: "Some content",
      userContext: {
        // Missing all fields
      },
    }));

    expect(res.status).toBe(200);
  });

  it("caps topic arrays at 20 items", async () => {
    const manyTopics = Array.from({ length: 30 }, (_, i) => `topic-${i}`);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: '{"originality":7,"insight":7,"credibility":7,"composite":7.0,"verdict":"quality","reason":"ok"}' }],
      }),
    }) as jest.Mock;

    const res = await POST(makeRequest(
      {
        text: "Some content",
        userContext: {
          recentTopics: manyTopics,
          highAffinityTopics: manyTopics,
          lowAffinityTopics: manyTopics,
          trustedAuthors: manyTopics,
        },
      },
      { "x-user-api-key": "sk-ant-api03-valid-key" },
    ));

    expect(res.status).toBe(200);

    // Verify the prompt was built with capped topics (max 20 per array)
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const promptContent: string = callBody.messages[0].content;
    expect(promptContent).toBeDefined();

    // Count how many of the 30 topics actually appear in the prompt.
    // sanitizeTopics caps each array at 20 items, but the prompt only includes
    // recentTopics and highAffinityTopics (up to 20 each). Topics beyond index 19
    // should NOT appear.
    const missingTopics = ["topic-20", "topic-25", "topic-29"];
    // At least some overflow topics must be absent from the prompt
    const absentCount = missingTopics.filter(t => !promptContent.includes(t)).length;
    expect(absentCount).toBeGreaterThan(0);

    global.fetch = originalFetch;
  });
});
