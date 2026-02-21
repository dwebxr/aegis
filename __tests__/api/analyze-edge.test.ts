import { POST } from "@/app/api/analyze/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";
import { _resetDailyBudget } from "@/lib/api/dailyBudget";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analyze — edge cases", () => {
  beforeEach(() => {
    _resetRateLimits();
    _resetDailyBudget();
  });

  describe("input boundary conditions", () => {
    it("returns 400 for text exceeding 10000 characters", async () => {
      const longText = "a".repeat(10001);
      const res = await POST(makeRequest({ text: longText }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("10000");
    });

    it("accepts text at exactly 10000 characters", async () => {
      const text = "a".repeat(10000);
      const res = await POST(makeRequest({ text }));
      // Should not be 400 (will fall through to heuristic since no API key)
      expect(res.status).toBe(200);
    });

    it("returns 400 for whitespace-only text", async () => {
      const res = await POST(makeRequest({ text: "   \n\t  " }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for null text", async () => {
      const res = await POST(makeRequest({ text: null }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for numeric text", async () => {
      const res = await POST(makeRequest({ text: 12345 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for array text", async () => {
      const res = await POST(makeRequest({ text: ["hello"] }));
      expect(res.status).toBe(400);
    });
  });

  describe("heuristic fallback (no API key)", () => {
    it("returns heuristic tier when no ANTHROPIC_API_KEY", async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const res = await POST(makeRequest({ text: "Some reasonable content with analysis and data: 42% improvement" }));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.tier).toBe("heuristic");
        expect(data.composite).toBeGreaterThanOrEqual(1);
        expect(data.composite).toBeLessThanOrEqual(10);
        expect(["quality", "slop"]).toContain(data.verdict);
      } finally {
        if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });

    it("heuristic scores are clamped to [0, 10]", async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        // Very spammy content: should drive scores to 0 floor
        const res = await POST(makeRequest({
          text: "BUY NOW!!! AMAZING!!! WOW!!! INCREDIBLE!!! MUST SEE!!!"
        }));
        const data = await res.json();
        expect(data.originality).toBeGreaterThanOrEqual(0);
        expect(data.insight).toBeGreaterThanOrEqual(0);
        expect(data.credibility).toBeGreaterThanOrEqual(0);
        expect(data.originality).toBeLessThanOrEqual(10);
        expect(data.insight).toBeLessThanOrEqual(10);
        expect(data.credibility).toBeLessThanOrEqual(10);
      } finally {
        if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });

    it("includes reason in heuristic response", async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const res = await POST(makeRequest({
          text: "Detailed analysis with evidence: 95% improvement in benchmark. According to the methodology used, the hypothesis is supported."
        }));
        const data = await res.json();
        expect(data.reason).toBeDefined();
        expect(data.reason.length).toBeGreaterThan(0);
        expect(data.reason).toContain("Heuristic");
      } finally {
        if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });
  });

  describe("personalization with userContext", () => {
    it("accepts userContext without errors (heuristic path)", async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const res = await POST(makeRequest({
          text: "Research on transformers and attention mechanisms with data.",
          userContext: {
            highAffinityTopics: ["AI", "transformers"],
            lowAffinityTopics: ["sports"],
            trustedAuthors: ["researcher1"],
            recentTopics: ["deep-learning"],
          },
        }));
        expect(res.status).toBe(200);
        // UserContext is only used for Claude prompt, heuristic ignores it
        const data = await res.json();
        expect(data.tier).toBe("heuristic");
      } finally {
        if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after exceeding rate limit", async () => {
      // Rate limit is 20 per 60s for /api/analyze
      for (let i = 0; i < 20; i++) {
        const res = await POST(makeRequest({ text: "test content " + i }));
        expect(res.status).not.toBe(429);
      }

      // 21st request should be rate limited
      const res = await POST(makeRequest({ text: "one more" }));
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toContain("Rate limit");
    });
  });

  describe("invalid JSON body", () => {
    it("returns 400 for invalid JSON", async () => {
      const req = new NextRequest("http://localhost:3000/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json {{{",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("JSON");
    });
  });
});
