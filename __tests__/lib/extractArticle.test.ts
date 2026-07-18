const mockSafeFetch = jest.fn();
const mockExtractFromHtml = jest.fn();
const mockCaptureException = jest.fn();

jest.mock("@/lib/utils/safeFetch.server", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));
jest.mock("@extractus/article-extractor", () => ({
  extractFromHtml: (...args: unknown[]) => mockExtractFromHtml(...args),
}));
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { _resetUrlCache } from "@/lib/cache/urlExtract";
import { extractArticle } from "@/lib/extraction/extractArticle.server";

function htmlResponse(html = "<html><body>article</body></html>"): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  } as unknown as Response;
}

function article(content = "Substantial article content with enough useful detail to pass the minimum length check.") {
  return { title: "Article", content };
}

describe("extractArticle", () => {
  beforeEach(() => {
    _resetUrlCache();
    mockSafeFetch.mockReset();
    mockExtractFromHtml.mockReset();
    mockCaptureException.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("rejects URLs containing userinfo before fetching", async () => {
    const result = await extractArticle("https://user:secret@example.com/article");
    expect(result.status).toBe(400);
    expect(result.error).toContain("credentials");
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("rejects private targets before fetching", async () => {
    const result = await extractArticle("http://127.0.0.1/private");
    expect(result.status).toBe(400);
    expect(result.error).toContain("Localhost");
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("passes the user-agent and abort signal to safeFetch", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse());
    mockExtractFromHtml.mockResolvedValueOnce(article());

    const result = await extractArticle("https://example.com/article");

    expect(result.status).toBe(200);
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.objectContaining({
        headers: { "user-agent": "AegisBot/1.0 (+https://aegis-ai.xyz)" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("caps fetched HTML before extraction and extracted text before returning", async () => {
    const oversizedHtml = "a".repeat(5_000_100);
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(oversizedHtml));
    mockExtractFromHtml.mockResolvedValueOnce(article("b".repeat(12_000)));

    const result = await extractArticle("https://example.com/large");

    expect((mockExtractFromHtml.mock.calls[0][0] as string).length).toBe(5_000_000);
    expect(result.data?.content).toHaveLength(10_000);
  });

  it("returns the established 502 result when the outer extraction timeout wins", async () => {
    jest.useFakeTimers();
    mockSafeFetch.mockReturnValueOnce(new Promise(() => {}));

    // The repository's undici test adapter cannot exercise its connect-time
    // lookup hook, so this unit mocks safeFetch; DNS pinning remains covered by
    // fetch-url-ssrf and the timeout here is the outer Promise.race guard.
    const pending = extractArticle("https://example.com/slow");
    await jest.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result).toEqual({
      error: "Could not reach this URL. Please verify it is accessible.",
      status: 502,
    });
  });

  it("removes query and fragment data from failure telemetry", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    mockSafeFetch.mockRejectedValueOnce(new Error("unreachable"));

    await extractArticle("https://example.com/article?token=secret#private");

    expect(log).toHaveBeenCalledWith(
      "[fetch/url] Extract failed:",
      "https://example.com/article",
      "unreachable",
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: { url: "https://example.com/article" } }),
    );
  });
});
