const mockFetch = jest.fn();
const originalFetch = global.fetch;

import { POST } from "@/app/api/fetch/farcaster/route";
import { NextRequest } from "next/server";
import { _resetRateLimits } from "@/lib/api/rateLimit";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/fetch/farcaster", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fetch/farcaster", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
    _resetRateLimits();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("action: resolve", () => {
    it("resolves username to fid", async () => {
      mockFetch
        // userNameProofByName
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ fid: 5650 }),
          text: async () => "",
        })
        // userDataByFid (profile)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [
              { data: { fid: 5650, userDataBody: { type: "USER_DATA_TYPE_DISPLAY", value: "Vitalik Buterin" } } },
              { data: { fid: 5650, userDataBody: { type: "USER_DATA_TYPE_PFP", value: "https://example.com/pfp.jpg" } } },
              { data: { fid: 5650, userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: "vitalik" } } },
            ],
          }),
          text: async () => "",
        });

      const res = await POST(makeRequest({ action: "resolve", username: "vitalik" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.fid).toBe(5650);
      expect(data.displayName).toBe("Vitalik Buterin");
      expect(data.pfpUrl).toBe("https://example.com/pfp.jpg");
      expect(data.username).toBe("vitalik");
    });

    it("returns 404 for unknown username", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not found",
      });

      const res = await POST(makeRequest({ action: "resolve", username: "nonexistent_user_xyz" }));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 400 for missing username", async () => {
      const res = await POST(makeRequest({ action: "resolve" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("username");
    });

    it("returns 400 for username too long", async () => {
      const res = await POST(makeRequest({ action: "resolve", username: "a".repeat(31) }));
      expect(res.status).toBe(400);
    });

    it("handles Hub API error gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const res = await POST(makeRequest({ action: "resolve", username: "testuser" }));
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("Failed to resolve");
    });
  });

  describe("action: feed", () => {
    it("returns casts for valid fid", async () => {
      mockFetch
        // userDataByFid (profile)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [
              { data: { fid: 5650, userDataBody: { type: "USER_DATA_TYPE_DISPLAY", value: "Vitalik" } } },
              { data: { fid: 5650, userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: "vitalik" } } },
            ],
          }),
          text: async () => "",
        })
        // castsByFid
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [
              {
                data: {
                  type: "MESSAGE_TYPE_CAST_ADD",
                  fid: 5650,
                  timestamp: 1700000000,
                  castAddBody: {
                    text: "Hello Farcaster!",
                    embeds: [{ url: "https://example.com/image.jpg" }],
                  },
                },
                hash: "0xabc123def456",
              },
              {
                data: {
                  type: "MESSAGE_TYPE_CAST_ADD",
                  fid: 5650,
                  timestamp: 1700000010,
                  castAddBody: {
                    text: "Another cast",
                    embeds: [],
                  },
                },
                hash: "0xdef789012345",
              },
            ],
          }),
          text: async () => "",
        });

      const res = await POST(makeRequest({ action: "feed", fid: 5650, limit: 10 }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(2);
      expect(data.items[0].text).toBe("Hello Farcaster!");
      expect(data.items[0].author).toBe("Vitalik");
      expect(data.items[0].imageUrl).toBe("https://example.com/image.jpg");
      expect(data.items[0].sourceUrl).toBe("https://warpcast.com/vitalik/0xabc123de");
      expect(data.items[1].text).toBe("Another cast");
      expect(data.items[1].imageUrl).toBeUndefined();
      expect(data.feedTitle).toContain("vitalik");
    });

    it("returns 400 for missing fid", async () => {
      const res = await POST(makeRequest({ action: "feed" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("fid");
    });

    it("returns 400 for non-numeric fid", async () => {
      const res = await POST(makeRequest({ action: "feed", fid: "abc" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for zero fid", async () => {
      const res = await POST(makeRequest({ action: "feed", fid: 0 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for negative fid", async () => {
      const res = await POST(makeRequest({ action: "feed", fid: -1 }));
      expect(res.status).toBe(400);
    });

    it("caps limit at 50", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
          text: async () => "",
        });

      await POST(makeRequest({ action: "feed", fid: 1, limit: 100 }));
      const hubCall = mockFetch.mock.calls[1][0] as string;
      expect(hubCall).toContain("pageSize=50");
    });

    it("filters non-cast messages", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [] }),
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [
              {
                data: { type: "MESSAGE_TYPE_CAST_ADD", fid: 1, timestamp: 100, castAddBody: { text: "valid cast", embeds: [] } },
                hash: "0xaaa",
              },
              {
                data: { type: "MESSAGE_TYPE_REACTION_ADD", fid: 1, timestamp: 101 },
                hash: "0xbbb",
              },
            ],
          }),
          text: async () => "",
        });

      const res = await POST(makeRequest({ action: "feed", fid: 1 }));
      const data = await res.json();
      expect(data.items).toHaveLength(1);
      expect(data.items[0].text).toBe("valid cast");
    });
  });

  describe("invalid action", () => {
    it("returns 400 for unknown action", async () => {
      const res = await POST(makeRequest({ action: "unknown" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid action");
    });

    it("returns 400 for missing action", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
    });
  });

  describe("image extraction", () => {
    it("extracts jpg from embeds", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }), text: async () => "" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [{
              data: {
                type: "MESSAGE_TYPE_CAST_ADD", fid: 1, timestamp: 100,
                castAddBody: { text: "pic", embeds: [{ url: "https://example.com/photo.jpg" }] },
              },
              hash: "0ximg",
            }],
          }),
          text: async () => "",
        });

      const res = await POST(makeRequest({ action: "feed", fid: 1 }));
      const data = await res.json();
      expect(data.items[0].imageUrl).toBe("https://example.com/photo.jpg");
    });

    it("extracts png with query params", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }), text: async () => "" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [{
              data: {
                type: "MESSAGE_TYPE_CAST_ADD", fid: 1, timestamp: 100,
                castAddBody: { text: "pic", embeds: [{ url: "https://cdn.example.com/img.png?w=400" }] },
              },
              hash: "0xpng",
            }],
          }),
          text: async () => "",
        });

      const res = await POST(makeRequest({ action: "feed", fid: 1 }));
      const data = await res.json();
      expect(data.items[0].imageUrl).toBe("https://cdn.example.com/img.png?w=400");
    });

    it("extracts CDN URL without file extension (imagedelivery.net)", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }), text: async () => "" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [{
              data: {
                type: "MESSAGE_TYPE_CAST_ADD", fid: 1, timestamp: 100,
                castAddBody: { text: "pic", embeds: [{ url: "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/abc123/original" }] },
              },
              hash: "0xcdn",
            }],
          }),
          text: async () => "",
        });

      const res = await POST(makeRequest({ action: "feed", fid: 1 }));
      const data = await res.json();
      expect(data.items[0].imageUrl).toBe("https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/abc123/original");
    });

    it("returns undefined for non-image embeds", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }), text: async () => "" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [{
              data: {
                type: "MESSAGE_TYPE_CAST_ADD", fid: 1, timestamp: 100,
                castAddBody: { text: "link", embeds: [{ url: "https://example.com/article" }] },
              },
              hash: "0xlink",
            }],
          }),
          text: async () => "",
        });

      const res = await POST(makeRequest({ action: "feed", fid: 1 }));
      const data = await res.json();
      expect(data.items[0].imageUrl).toBeUndefined();
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after exceeding rate limit", async () => {
      for (let i = 0; i < 20; i++) {
        await POST(makeRequest({ action: "resolve", username: "test" }));
      }
      const res = await POST(makeRequest({ action: "resolve", username: "test" }));
      expect(res.status).toBe(429);
    });
  });
});
