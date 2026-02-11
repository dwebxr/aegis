import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

// Mock twitter-api-v2 to test error handling paths without real API calls
const mockSearch = jest.fn();
jest.mock("twitter-api-v2", () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({
    readOnly: {
      v2: { search: mockSearch },
    },
  })),
}));

import { POST } from "@/app/api/fetch/twitter/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/twitter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/twitter — API error handling", () => {
  beforeEach(() => {
    _resetRateLimits();
    mockSearch.mockReset();
  });

  it("returns 401 for unauthorized API error", async () => {
    mockSearch.mockRejectedValueOnce(new Error("401 Unauthorized"));
    const res = await POST(makeRequest({ bearerToken: "bad-token", query: "test" }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Invalid or expired");
  });

  it("returns 429 for rate limit API error", async () => {
    mockSearch.mockRejectedValueOnce(new Error("429 Rate limit exceeded"));
    const res = await POST(makeRequest({ bearerToken: "tok", query: "test" }));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toContain("rate limit");
  });

  it("returns 403 for forbidden API error (access tier)", async () => {
    mockSearch.mockRejectedValueOnce(new Error("403 Forbidden"));
    const res = await POST(makeRequest({ bearerToken: "tok", query: "test" }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("access level");
  });

  it("returns 500 for generic API error", async () => {
    mockSearch.mockRejectedValueOnce(new Error("Network connection lost"));
    const res = await POST(makeRequest({ bearerToken: "tok", query: "test" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("failed");
  });

  describe("successful response with user mapping", () => {
    it("maps author data from user expansions", async () => {
      mockSearch.mockResolvedValueOnce({
        data: {
          data: [
            { id: "t1", text: "Hello world", author_id: "u1", created_at: "2024-01-01T00:00:00Z" },
            { id: "t2", text: "Second tweet", author_id: "u2", created_at: "2024-01-01T01:00:00Z" },
          ],
        },
        includes: {
          users: [
            { id: "u1", name: "Alice", username: "alice" },
            { id: "u2", name: "Bob", username: "bob" },
          ],
        },
      });

      const res = await POST(makeRequest({ bearerToken: "tok", query: "test" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tweets).toHaveLength(2);
      expect(data.tweets[0].author).toBe("Alice");
      expect(data.tweets[0].authorHandle).toBe("@alice");
      expect(data.tweets[1].author).toBe("Bob");
      expect(data.tweets[1].authorHandle).toBe("@bob");
    });

    it("handles tweets with unknown author_id", async () => {
      mockSearch.mockResolvedValueOnce({
        data: {
          data: [
            { id: "t1", text: "Orphan tweet", author_id: "u_unknown", created_at: "" },
          ],
        },
        includes: { users: [] },
      });

      const res = await POST(makeRequest({ bearerToken: "tok", query: "test" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tweets[0].author).toBe("Unknown");
      expect(data.tweets[0].authorHandle).toBe("@unknown");
    });

    it("handles empty result set", async () => {
      mockSearch.mockResolvedValueOnce({
        data: { data: [] },
        includes: {},
      });

      const res = await POST(makeRequest({ bearerToken: "tok", query: "obscure query xyz" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tweets).toEqual([]);
    });

    it("handles null data (no results)", async () => {
      mockSearch.mockResolvedValueOnce({
        data: {},
        includes: {},
      });

      const res = await POST(makeRequest({ bearerToken: "tok", query: "noresults" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tweets).toEqual([]);
    });

    it("handles missing includes.users", async () => {
      mockSearch.mockResolvedValueOnce({
        data: {
          data: [{ id: "t1", text: "Tweet", author_id: "u1" }],
        },
        // no includes
      });

      const res = await POST(makeRequest({ bearerToken: "tok", query: "test" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tweets[0].author).toBe("Unknown");
    });

    it("handles tweet with no author_id", async () => {
      mockSearch.mockResolvedValueOnce({
        data: {
          data: [{ id: "t1", text: "No author", created_at: "" }],
        },
        includes: {},
      });

      const res = await POST(makeRequest({ bearerToken: "tok", query: "test" }));
      const data = await res.json();
      expect(data.tweets[0].author).toBe("Unknown");
    });
  });

  describe("maxResults clamping", () => {
    it("clamps maxResults to minimum 10", async () => {
      mockSearch.mockResolvedValueOnce({ data: { data: [] }, includes: {} });
      await POST(makeRequest({ bearerToken: "tok", query: "test", maxResults: 1 }));
      expect(mockSearch).toHaveBeenCalledWith("test", expect.objectContaining({ max_results: 10 }));
    });

    it("clamps maxResults to maximum 100", async () => {
      mockSearch.mockResolvedValueOnce({ data: { data: [] }, includes: {} });
      await POST(makeRequest({ bearerToken: "tok", query: "test", maxResults: 500 }));
      expect(mockSearch).toHaveBeenCalledWith("test", expect.objectContaining({ max_results: 100 }));
    });

    it("passes valid maxResults through", async () => {
      mockSearch.mockResolvedValueOnce({ data: { data: [] }, includes: {} });
      await POST(makeRequest({ bearerToken: "tok", query: "test", maxResults: 50 }));
      expect(mockSearch).toHaveBeenCalledWith("test", expect.objectContaining({ max_results: 50 }));
    });

    it("defaults maxResults to 10 when not provided", async () => {
      mockSearch.mockResolvedValueOnce({ data: { data: [] }, includes: {} });
      await POST(makeRequest({ bearerToken: "tok", query: "test" }));
      expect(mockSearch).toHaveBeenCalledWith("test", expect.objectContaining({ max_results: 10 }));
    });
  });
});
