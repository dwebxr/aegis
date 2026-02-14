import { POST } from "@/app/api/analyze/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analyze", () => {
  beforeEach(() => {
    _resetRateLimits();
  });
  describe("input validation", () => {
    it("returns 400 for missing text", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("required");
    });

    it("returns 400 for empty string text", async () => {
      const res = await POST(makeRequest({ text: "" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for whitespace-only text", async () => {
      const res = await POST(makeRequest({ text: "   " }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string text", async () => {
      const res = await POST(makeRequest({ text: 123 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for text exceeding 10000 characters", async () => {
      const res = await POST(makeRequest({ text: "x".repeat(10001) }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("10000");
    });

    it("accepts text at exactly 10000 characters", async () => {
      const res = await POST(makeRequest({ text: "a".repeat(10000) }));
      // Should succeed (with fallback since no API key)
      expect(res.status).toBe(200);
    });
  });

  describe("fallback scoring (no API key)", () => {
    // In test env, ANTHROPIC_API_KEY is not set, so fallback is always used

    it("returns fallback scores for normal text with tier indicator", async () => {
      const res = await POST(makeRequest({
        text: "A thoughtful analysis of artificial intelligence and its impact on society.",
      }));
      expect(res.status).toBe(200);
      const data = await res.json();

      // Fallback returns scores directly (flattened, no wrapper)
      expect(data.originality).toBeGreaterThanOrEqual(0);
      expect(data.originality).toBeLessThanOrEqual(10);
      expect(data.insight).toBeGreaterThanOrEqual(0);
      expect(data.credibility).toBeGreaterThanOrEqual(0);
      expect(data.composite).toBeGreaterThanOrEqual(0);
      expect(["quality", "slop"]).toContain(data.verdict);
      expect(data.reason).toBeDefined();
      // LARP fix: tier is now explicit
      expect(data.tier).toBe("heuristic");
    });

    it("returns quality verdict for clean content", async () => {
      const res = await POST(makeRequest({
        text: "The research paper published in Nature demonstrates a novel approach to protein folding using AI models.",
      }));
      const data = await res.json();
      expect(data.verdict).toBe("quality");
    });

    it("returns slop verdict for clickbait content", async () => {
      const res = await POST(makeRequest({
        text: "OMG!!! YOU WON'T BELIEVE THIS!!! AMAZING!!! SHOCKING!!! CLICK NOW!!!",
      }));
      const data = await res.json();
      expect(data.verdict).toBe("slop");
    });

    it("fallback scores reflect text quality heuristics", async () => {
      // Text with links and data → higher credibility/insight
      const res = await POST(makeRequest({
        text: "According to https://nature.com the study found 95% accuracy in predictions.",
      }));
      const data = await res.json();
      expect(data.credibility).toBeGreaterThan(5);
      expect(data.insight).toBeGreaterThan(5);
    });

    it("does not include vSignal/cContext/lSlop in fallback (no personalization)", async () => {
      const res = await POST(makeRequest({
        text: "Simple test content.",
      }));
      const data = await res.json();
      // Fallback doesn't produce V/C/L scores
      expect(data.vSignal).toBeUndefined();
      expect(data.cContext).toBeUndefined();
      expect(data.lSlop).toBeUndefined();
    });
  });

  describe("with userContext parameter", () => {
    it("accepts userContext without error", async () => {
      const res = await POST(makeRequest({
        text: "Content about machine learning research.",
        userContext: {
          recentTopics: ["ml", "ai"],
          highAffinityTopics: ["transformers"],
          lowAffinityTopics: ["crypto"],
          trustedAuthors: ["dr-smith"],
        },
      }));
      expect(res.status).toBe(200);
      // Still uses fallback since no API key
      const data = await res.json();
      expect(data.originality).toBeGreaterThanOrEqual(0);
    });

    it("handles null userContext gracefully", async () => {
      const res = await POST(makeRequest({
        text: "Test content.",
        userContext: null,
      }));
      expect(res.status).toBe(200);
    });
  });

  describe("concurrent requests", () => {
    it("handles multiple simultaneous requests", async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        POST(makeRequest({ text: `Concurrent test content number ${i}` }))
      );
      const responses = await Promise.all(requests);
      responses.forEach(res => {
        expect(res.status).toBe(200);
      });
    });
  });

  describe("edge case text content", () => {
    it("handles text with unicode characters", async () => {
      const res = await POST(makeRequest({
        text: "日本語のテストコンテンツ。人工知能に関する研究。",
      }));
      expect(res.status).toBe(200);
    });

    it("handles text with only special characters", async () => {
      const res = await POST(makeRequest({
        text: "@#$%^&*()_+{}|:<>?",
      }));
      expect(res.status).toBe(200);
    });

    it("handles multiline text", async () => {
      const res = await POST(makeRequest({
        text: "Line 1\nLine 2\nLine 3\n\nParagraph 2",
      }));
      expect(res.status).toBe(200);
    });
  });
});
