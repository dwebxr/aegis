import { POST } from "@/app/api/analyze/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockClaudeResponse(text: string, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      content: [{ type: "text", text }],
    }),
  });
}

describe("POST /api/analyze — Anthropic API path", () => {
  beforeEach(() => {
    _resetRateLimits();
    process.env.ANTHROPIC_API_KEY = "test-api-key-123";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("successful Claude responses", () => {
    it("returns parsed Claude scores with tier=claude", async () => {
      mockClaudeResponse(JSON.stringify({
        originality: 8,
        insight: 7,
        credibility: 9,
        composite: 8.1,
        verdict: "quality",
        reason: "Well-researched article with data",
      }));

      const res = await POST(makeRequest({ text: "A detailed research article." }));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.originality).toBe(8);
      expect(data.insight).toBe(7);
      expect(data.credibility).toBe(9);
      expect(data.composite).toBe(8.1);
      expect(data.verdict).toBe("quality");
      expect(data.reason).toBe("Well-researched article with data");
      expect(data.tier).toBe("claude");
    });

    it("returns V/C/L scores and topics when present in Claude response", async () => {
      mockClaudeResponse(JSON.stringify({
        vSignal: 9,
        cContext: 7,
        lSlop: 2,
        originality: 8,
        insight: 8,
        credibility: 8,
        composite: 8.5,
        verdict: "quality",
        reason: "High signal content",
        topics: ["ai", "transformers"],
      }));

      const res = await POST(makeRequest({
        text: "Novel research on transformer architectures.",
        userContext: {
          recentTopics: ["ai"],
          highAffinityTopics: ["ml"],
          lowAffinityTopics: [],
          trustedAuthors: [],
        },
      }));
      const data = await res.json();

      expect(data.vSignal).toBe(9);
      expect(data.cContext).toBe(7);
      expect(data.lSlop).toBe(2);
      expect(data.topics).toEqual(["ai", "transformers"]);
      expect(data.tier).toBe("claude");
    });

    it("handles Claude response wrapped in markdown code blocks", async () => {
      mockClaudeResponse("```json\n" + JSON.stringify({
        originality: 6,
        insight: 5,
        credibility: 7,
        composite: 5.8,
        verdict: "quality",
        reason: "Decent content",
      }) + "\n```");

      const res = await POST(makeRequest({ text: "Test content." }));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.composite).toBe(5.8);
      expect(data.verdict).toBe("quality");
    });

    it("sends correct model and headers to Anthropic API", async () => {
      mockClaudeResponse(JSON.stringify({
        originality: 5, insight: 5, credibility: 5, composite: 5, verdict: "quality", reason: "ok",
      }));

      await POST(makeRequest({ text: "Test." }));

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-key": "test-api-key-123",
            "anthropic-version": "2023-06-01",
          }),
        }),
      );

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe("claude-sonnet-4-20250514");
      expect(body.max_tokens).toBe(1000);
    });

    it("includes personalized prompt when userContext has topics", async () => {
      mockClaudeResponse(JSON.stringify({
        vSignal: 7, cContext: 8, lSlop: 1,
        originality: 7, insight: 7, credibility: 7, composite: 7, verdict: "quality", reason: "ok",
        topics: ["ai"],
      }));

      await POST(makeRequest({
        text: "AI research paper.",
        userContext: {
          recentTopics: ["ai", "ml"],
          highAffinityTopics: ["transformers"],
          lowAffinityTopics: ["crypto"],
          trustedAuthors: [],
        },
      }));

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const prompt = body.messages[0].content;
      expect(prompt).toContain("V/C/L");
      expect(prompt).toContain("ai, ml");
      expect(prompt).toContain("transformers");
      expect(prompt).toContain("crypto");
    });

    it("uses legacy prompt when userContext has no topics", async () => {
      mockClaudeResponse(JSON.stringify({
        originality: 5, insight: 5, credibility: 5, composite: 5, verdict: "quality", reason: "ok",
      }));

      await POST(makeRequest({
        text: "Test content.",
        userContext: { recentTopics: [], highAffinityTopics: [], lowAffinityTopics: [], trustedAuthors: [] },
      }));

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const prompt = body.messages[0].content;
      expect(prompt).not.toContain("V/C/L");
      expect(prompt).toContain("Originality (40%)");
    });

    it("truncates input text to 5000 chars in prompt", async () => {
      mockClaudeResponse(JSON.stringify({
        originality: 5, insight: 5, credibility: 5, composite: 5, verdict: "quality", reason: "ok",
      }));

      const longText = "x".repeat(8000);
      await POST(makeRequest({ text: longText }));

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const prompt = body.messages[0].content;
      // Prompt should contain at most 5000 chars of content, not 8000
      expect(prompt.length).toBeLessThan(8000);
    });
  });

  describe("error handling", () => {
    it("falls back to heuristic when Claude returns non-JSON", async () => {
      mockClaudeResponse("I cannot analyze this content properly because it lacks context.");

      const res = await POST(makeRequest({ text: "Valid but confusing text." }));
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.error).toContain("Failed to parse AI response");
      expect(data.fallback).toBeDefined();
      expect(data.fallback.tier).toBe("heuristic");
    });

    it("falls back to heuristic when Anthropic API returns HTTP error", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: "rate limited" }),
      });

      const res = await POST(makeRequest({ text: "Some text." }));
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.error).toContain("Anthropic API error: 429");
      expect(data.fallback.tier).toBe("heuristic");
    });

    it("falls back to heuristic when Anthropic API returns 500", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const res = await POST(makeRequest({ text: "Some text." }));
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.fallback.tier).toBe("heuristic");
    });

    it("falls back to heuristic when fetch throws (network error)", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network unreachable"));

      const res = await POST(makeRequest({ text: "Test text." }));
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.error).toBe("Request failed");
      expect(data.fallback.tier).toBe("heuristic");
    });

    it("falls back when Claude response JSON is valid but empty content", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [] }), // empty content array
      });

      const res = await POST(makeRequest({ text: "Test text." }));
      // Empty content → rawText = "" → JSON.parse fails → 502
      expect(res.status).toBe(502);
    });

    it("falls back when response body is not valid JSON", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error("Invalid JSON"); },
      });

      const res = await POST(makeRequest({ text: "Test text." }));
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.error).toContain("Failed to parse Anthropic response");
    });
  });

  describe("missing reason in response", () => {
    it("defaults reason to empty string when not provided by Claude", async () => {
      mockClaudeResponse(JSON.stringify({
        originality: 5, insight: 5, credibility: 5, composite: 5, verdict: "quality",
        // no "reason" field
      }));

      const res = await POST(makeRequest({ text: "Test." }));
      const data = await res.json();
      expect(data.reason).toBe("");
    });
  });
});
