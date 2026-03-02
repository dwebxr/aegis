import { safeFetch } from "@/lib/utils/url";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    body: null,
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("safeFetch", () => {
  it("returns response for non-redirect status", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    const res = await safeFetch("https://example.com/feed");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("follows redirect and returns final response", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(301, { location: "https://new.example.com/feed" }))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await safeFetch("https://example.com/old");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe("https://new.example.com/feed");
  });

  it("resolves relative redirect locations against current URL", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(302, { location: "/new-path" }))
      .mockResolvedValueOnce(mockResponse(200));

    await safeFetch("https://example.com/old-path");
    expect(mockFetch.mock.calls[1][0]).toBe("https://example.com/new-path");
  });

  it("blocks redirect to private IP (SSRF)", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(302, { location: "http://169.254.169.254/metadata" }));

    await expect(safeFetch("https://example.com/redirect"))
      .rejects.toThrow(/metadata|Link-local/i);
  });

  it("blocks redirect to localhost (SSRF)", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(301, { location: "http://127.0.0.1:8080/admin" }));

    await expect(safeFetch("https://example.com/"))
      .rejects.toThrow(/Localhost/i);
  });

  it("blocks redirect to 10.x.x.x (SSRF)", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(302, { location: "http://10.0.0.1/internal" }));

    await expect(safeFetch("https://example.com/"))
      .rejects.toThrow(/Private network/i);
  });

  it("blocks initial URL if private", async () => {
    await expect(safeFetch("http://192.168.1.1/admin"))
      .rejects.toThrow(/Private network/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on too many redirects", async () => {
    // 6 consecutive redirects with maxRedirects=5
    for (let i = 0; i < 6; i++) {
      mockFetch.mockResolvedValueOnce(mockResponse(302, { location: `https://example.com/r${i}` }));
    }

    await expect(safeFetch("https://example.com/start", undefined, 5))
      .rejects.toThrow("Too many redirects");
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it("returns redirect response if no Location header", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(301));
    const res = await safeFetch("https://example.com/");
    expect(res.status).toBe(301);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("passes init options with redirect:manual", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    await safeFetch("https://example.com/", {
      method: "POST",
      headers: { "X-Custom": "value" },
    });
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/", expect.objectContaining({
      method: "POST",
      redirect: "manual",
      headers: { "X-Custom": "value" },
    }));
  });

  it("handles multi-hop redirect chain", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(301, { location: "https://hop1.com/" }))
      .mockResolvedValueOnce(mockResponse(302, { location: "https://hop2.com/" }))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await safeFetch("https://start.com/");
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("blocks SSRF at any hop in redirect chain", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(301, { location: "https://hop1.com/" }))
      .mockResolvedValueOnce(mockResponse(302, { location: "http://10.0.0.1/secret" }));

    await expect(safeFetch("https://start.com/"))
      .rejects.toThrow(/Private network/i);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("handles 304 Not Modified without redirect", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(304));
    const res = await safeFetch("https://example.com/feed");
    expect(res.status).toBe(304);
  });

  it("rejects non-HTTP protocol", async () => {
    await expect(safeFetch("ftp://example.com/file"))
      .rejects.toThrow(/Only HTTP/i);
  });

  it("rejects invalid URL", async () => {
    await expect(safeFetch("not-a-url"))
      .rejects.toThrow();
  });

  it("respects custom maxRedirects=0 (no redirects)", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(302, { location: "https://example.com/next" }));

    await expect(safeFetch("https://example.com/", undefined, 0))
      .rejects.toThrow("Too many redirects");
  });
});
