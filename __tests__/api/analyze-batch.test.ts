import { POST } from "@/app/api/analyze/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const originalFetch = global.fetch;

function makeRequest(
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mockAnthropicSuccess(overrides: Record<string, unknown> = {}) {
  const scoreJson = JSON.stringify({
    originality: 7,
    insight: 6,
    credibility: 8,
    composite: 7,
    verdict: "Quality content",
    reason: "Well-written analysis",
    topics: ["tech"],
    vSignal: 0.8,
    cContext: 0.7,
    lSlop: 0.1,
    scoringEngine: "claude",
    ...overrides,
  });

  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      content: [{ text: scoreJson }],
    }),
  });
}

describe("POST /api/analyze — batch mode", () => {
  beforeEach(() => {
    _resetRateLimits();
    global.fetch = originalFetch;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("input validation", () => {
    it("returns 400 when texts is an empty array", async () => {
      const res = await POST(makeRequest({ texts: [] }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("text");
    });

    it("returns 400 when all texts are empty strings", async () => {
      const res = await POST(makeRequest({ texts: ["", "  ", ""] }));
      expect(res.status).toBe(400);
    });

    it("filters non-string entries from texts array", async () => {
      const res = await POST(makeRequest({
        texts: [123, null, "Valid text content here", undefined],
      }));
      // No API key → heuristic fallback
      const data = await res.json();
      expect(data.results).toHaveLength(1);
    });
  });

  describe("heuristic fallback (no API key)", () => {
    it("returns heuristic scores for all texts when no API key", async () => {
      const res = await POST(makeRequest({
        texts: ["First text content", "Second text content"],
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(2);
      expect(data.results[0].tier).toBe("heuristic");
      expect(data.results[1].tier).toBe("heuristic");
      // Check heuristic fields exist
      expect(data.results[0]).toHaveProperty("composite");
      expect(data.results[0]).toHaveProperty("originality");
    });
  });

  describe("AI scoring with API key", () => {
    it("scores all texts via Anthropic API", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
      global.fetch = jest.fn().mockImplementation(() => mockAnthropicSuccess());

      const res = await POST(makeRequest({
        texts: ["Text one for scoring", "Text two for scoring"],
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(2);
      expect(data.results[0].tier).toBe("claude");
      expect(data.results[1].tier).toBe("claude");
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("falls back to heuristic for individual failures", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockAnthropicSuccess();
        return Promise.resolve({ ok: false, status: 500 });
      });

      const res = await POST(makeRequest({
        texts: ["Good text here", "Text that fails"],
      }));
      const data = await res.json();
      expect(data.results).toHaveLength(2);
      expect(data.results[0].tier).toBe("claude");
      expect(data.results[1].tier).toBe("heuristic");
    });

    it("uses user-provided API key from header", async () => {
      global.fetch = jest.fn().mockImplementation(() => mockAnthropicSuccess());

      const res = await POST(makeRequest(
        { texts: ["Text content"] },
        { "x-user-api-key": "sk-ant-user-key-123" },
      ));
      const data = await res.json();
      expect(data.results[0].tier).toBe("claude");
      // Should have called Anthropic with the user key
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      expect(fetchCall[1].headers["x-api-key"]).toBe("sk-ant-user-key-123");
    });
  });

  describe("limits and truncation", () => {
    it("limits batch to 10 texts", async () => {
      const texts = Array.from({ length: 15 }, (_, i) => `Text content number ${i}`);
      const res = await POST(makeRequest({ texts }));
      const data = await res.json();
      expect(data.results).toHaveLength(10);
    });

    it("truncates individual texts to 10000 characters", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
      global.fetch = jest.fn().mockImplementation(() => mockAnthropicSuccess());

      const longText = "a".repeat(20000);
      await POST(makeRequest({ texts: [longText] }));

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      const prompt = body.messages[0].content;
      // The text in the prompt should be truncated
      expect(prompt.length).toBeLessThan(20000);
    });
  });

  describe("userContext sanitization in batch", () => {
    it("passes sanitized userContext to scoring", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
      global.fetch = jest.fn().mockImplementation(() => mockAnthropicSuccess());

      const res = await POST(makeRequest({
        texts: ["Text content here"],
        userContext: {
          recentTopics: ["crypto", "AI"],
          highAffinityTopics: ["security"],
          lowAffinityTopics: [],
          trustedAuthors: [],
        },
      }));
      const data = await res.json();
      expect(data.results).toHaveLength(1);
      expect(data.results[0].tier).toBe("claude");
    });
  });

  describe("precedence", () => {
    it("prefers texts over text when both provided", async () => {
      const res = await POST(makeRequest({
        text: "Single text",
        texts: ["Batch text one", "Batch text two"],
      }));
      const data = await res.json();
      // Batch mode wins — results array
      expect(data.results).toBeDefined();
      expect(data.results).toHaveLength(2);
    });
  });
});
