import {
  checkBazaarListings,
  fetchBazaarResources,
} from "@/scripts/bazaar-check";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("bazaar-check", () => {
  it("walks catalog pagination and matches endpoint paths independent of query strings", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [{ resource: "https://aegis-ai.xyz/api/d2a/score?url=https://example.com" }],
        pagination: { limit: 1, offset: 0, total: 3 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ resource: "https://aegis-ai.xyz/api/d2a/briefing/" }],
        pagination: { limit: 1, offset: 1, total: 3 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          resource: "https://aegis-ai.xyz/api/d2a/briefing/changes?since=2026-01-01T00:00:00Z",
        }],
        pagination: { limit: 1, offset: 2, total: 3 },
      })) as jest.MockedFunction<typeof fetch>;

    const results = await checkBazaarListings(fetchMock);

    expect(results.map((result) => result.listed)).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("offset=1");
  });

  it("reports absent endpoints without treating an empty catalog as an error", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({
      items: [],
      pagination: { limit: 1000, offset: 0, total: 0 },
    })) as unknown as jest.MockedFunction<typeof fetch>;

    await expect(fetchBazaarResources(fetchMock)).resolves.toEqual([]);
    await expect(checkBazaarListings(fetchMock)).resolves.toEqual([
      { target: "https://aegis-ai.xyz/api/d2a/score", listed: false },
      { target: "https://aegis-ai.xyz/api/d2a/briefing", listed: false },
      { target: "https://aegis-ai.xyz/api/d2a/briefing/changes", listed: false },
    ]);
  });
});
