// Mock localStorage (node test env)
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  },
  writable: true,
  configurable: true,
});

import {
  trackDomainValidation,
  getSuggestions,
  dismissSuggestion,
  discoverFeed,
} from "@/lib/sources/discovery";

const STORAGE_KEY = "aegis-domain-validations";
const originalFetch = global.fetch;

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

function getStoredData(): Record<string, { domain: string; count: number; lastValidatedAt: number; dismissed: boolean; feedUrl?: string }> {
  const raw = store[STORAGE_KEY];
  if (!raw) return {};
  return JSON.parse(raw);
}

describe("trackDomainValidation", () => {
  it("increments count for a new domain", () => {
    trackDomainValidation("https://example.com/article");
    const data = getStoredData();
    expect(data["example.com"]).toBeDefined();
    expect(data["example.com"].count).toBe(1);
  });

  it("increments existing domain count", () => {
    trackDomainValidation("https://example.com/article1");
    trackDomainValidation("https://example.com/article2");
    trackDomainValidation("https://example.com/article3");
    const data = getStoredData();
    expect(data["example.com"].count).toBe(3);
  });

  it("normalizes www. prefix", () => {
    trackDomainValidation("https://www.example.com/page");
    const data = getStoredData();
    // Should strip www.
    expect(data["example.com"]).toBeDefined();
    expect(data["www.example.com"]).toBeUndefined();
  });

  it("lowercases domain", () => {
    trackDomainValidation("https://EXAMPLE.COM/page");
    const data = getStoredData();
    expect(data["example.com"]).toBeDefined();
  });

  it("no-op for undefined sourceUrl", () => {
    trackDomainValidation(undefined);
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it("no-op for empty string sourceUrl", () => {
    trackDomainValidation("");
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it("handles malformed URLs without crash", () => {
    expect(() => trackDomainValidation("not-a-url")).not.toThrow();
    // No data stored for invalid URL
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it("ignores javascript: protocol URLs", () => {
    // eslint-disable-next-line no-script-url
    trackDomainValidation("javascript:alert(1)");
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it("handles URLs with ports and paths", () => {
    trackDomainValidation("https://blog.example.com:8080/post/123?ref=home");
    const data = getStoredData();
    expect(data["blog.example.com"]).toBeDefined();
    expect(data["blog.example.com"].count).toBe(1);
  });

  it("updates lastValidatedAt timestamp", () => {
    const before = Date.now();
    trackDomainValidation("https://example.com/page");
    const data = getStoredData();
    expect(data["example.com"].lastValidatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("getSuggestions", () => {
  function seedDomain(domain: string, count: number, dismissed = false) {
    const data = getStoredData();
    data[domain] = { domain, count, lastValidatedAt: Date.now(), dismissed };
    store[STORAGE_KEY] = JSON.stringify(data);
  }

  it("returns domains with count >= 3 (THRESHOLD)", () => {
    seedDomain("popular.com", 5);
    seedDomain("rare.com", 1);

    const suggestions = getSuggestions([]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].domain).toBe("popular.com");
  });

  it("returns empty when no domains meet threshold", () => {
    seedDomain("low.com", 2);
    expect(getSuggestions([])).toHaveLength(0);
  });

  it("excludes dismissed domains", () => {
    seedDomain("dismissed.com", 10);
    // Dismiss it
    const data = getStoredData();
    data["dismissed.com"].dismissed = true;
    store[STORAGE_KEY] = JSON.stringify(data);

    expect(getSuggestions([])).toHaveLength(0);
  });

  it("excludes already-subscribed feed URLs by domain match", () => {
    seedDomain("example.com", 5);
    // Already have an RSS feed from this domain
    const suggestions = getSuggestions(["https://example.com/feed.xml"]);
    expect(suggestions).toHaveLength(0);
  });

  it("domain comparison uses extractDomain (normalizes www.)", () => {
    seedDomain("example.com", 5);
    // Feed URL has www prefix but domain was stored without it
    const suggestions = getSuggestions(["https://www.example.com/rss"]);
    expect(suggestions).toHaveLength(0);
  });

  it("boundary: exactly 3 count meets threshold", () => {
    seedDomain("threshold.com", 3);
    expect(getSuggestions([])).toHaveLength(1);
  });

  it("boundary: 2 count does NOT meet threshold", () => {
    seedDomain("almost.com", 2);
    expect(getSuggestions([])).toHaveLength(0);
  });

  it("returns multiple qualifying domains", () => {
    seedDomain("a.com", 5);
    seedDomain("b.com", 3);
    seedDomain("c.com", 1);
    const suggestions = getSuggestions([]);
    expect(suggestions).toHaveLength(2);
    const domains = suggestions.map(s => s.domain);
    expect(domains).toContain("a.com");
    expect(domains).toContain("b.com");
  });

  it("returns empty array for empty localStorage", () => {
    expect(getSuggestions([])).toEqual([]);
  });
});

describe("dismissSuggestion", () => {
  it("sets dismissed=true for existing domain", () => {
    trackDomainValidation("https://example.com/a");
    dismissSuggestion("example.com");

    const data = getStoredData();
    expect(data["example.com"].dismissed).toBe(true);
  });

  it("no-op for unknown domain", () => {
    dismissSuggestion("nonexistent.com");
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it("persists dismissal across calls", () => {
    trackDomainValidation("https://example.com/a");
    trackDomainValidation("https://example.com/b");
    trackDomainValidation("https://example.com/c");

    dismissSuggestion("example.com");

    // Should not appear in suggestions
    const suggestions = getSuggestions([]);
    expect(suggestions).toHaveLength(0);
  });
});

describe("discoverFeed", () => {
  it("returns feedUrl from API response", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ feeds: [{ url: "https://example.com/feed.xml", type: "rss" }] }),
    });

    const result = await discoverFeed("example.com");
    expect(result).toBe("https://example.com/feed.xml");
  });

  it("returns null when API returns empty feeds", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ feeds: [] }),
    });

    const result = await discoverFeed("example.com");
    expect(result).toBeNull();
  });

  it("returns null on API error (non-ok response)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await discoverFeed("example.com");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

    const result = await discoverFeed("example.com");
    expect(result).toBeNull();
  });

  it("caches discovered feedUrl in domain validations", async () => {
    // First, track the domain so it exists in storage
    trackDomainValidation("https://example.com/article");

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ feeds: [{ url: "https://example.com/rss", type: "rss" }] }),
    });

    await discoverFeed("example.com");

    const data = getStoredData();
    expect(data["example.com"].feedUrl).toBe("https://example.com/rss");
  });

  it("calls API with POST and correct body", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ feeds: [] }),
    });

    await discoverFeed("blog.example.com");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/fetch/discover-feed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://blog.example.com" }),
      }),
    );
  });
});

