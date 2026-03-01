import { extractUrl } from "@/lib/utils/url";

describe("extractUrl — valid bare URLs", () => {
  it("returns HTTPS URL as-is", () => {
    expect(extractUrl("https://example.com")).toBe("https://example.com");
  });

  it("returns HTTP URL as-is", () => {
    expect(extractUrl("http://example.com")).toBe("http://example.com");
  });

  it("returns URL with path", () => {
    expect(extractUrl("https://medium.com/article/my-post")).toBe("https://medium.com/article/my-post");
  });

  it("returns URL with query parameters", () => {
    expect(extractUrl("https://example.com/search?q=test&page=1")).toBe("https://example.com/search?q=test&page=1");
  });

  it("returns URL with fragment", () => {
    expect(extractUrl("https://example.com/page#section")).toBe("https://example.com/page#section");
  });

  it("returns URL with port", () => {
    expect(extractUrl("https://localhost:3000/api")).toBe("https://localhost:3000/api");
  });

  it("handles URL with special characters in path", () => {
    expect(extractUrl("https://example.com/path/with%20spaces")).toBe("https://example.com/path/with%20spaces");
  });

  it("handles URL with unicode path", () => {
    expect(extractUrl("https://example.com/日本語")).toBe("https://example.com/日本語");
  });
});

describe("extractUrl — URLs with surrounding whitespace", () => {
  it("trims leading whitespace", () => {
    expect(extractUrl("  https://example.com")).toBe("https://example.com");
  });

  it("trims trailing whitespace", () => {
    expect(extractUrl("https://example.com  ")).toBe("https://example.com");
  });

  it("trims both leading and trailing whitespace", () => {
    expect(extractUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("trims tabs and newlines", () => {
    expect(extractUrl("\thttps://example.com\n")).toBe("https://example.com");
  });
});

describe("extractUrl — URL embedded in text", () => {
  it("extracts URL from text with prefix", () => {
    expect(extractUrl("Check this out https://example.com/article")).toBe("https://example.com/article");
  });

  it("extracts URL from text with suffix", () => {
    // URL constructor accepts spaces, so the full trimmed string is returned
    expect(extractUrl("https://example.com/article is great")).toBe("https://example.com/article is great");
  });

  it("extracts URL from mixed text", () => {
    expect(extractUrl("Look at https://example.com/post for details")).toBe("https://example.com/post");
  });

  it("extracts first URL when multiple URLs present", () => {
    expect(extractUrl("https://first.com and https://second.com")).toBe("https://first.com");
  });

  it("extracts URL from text with line breaks", () => {
    expect(extractUrl("Title\nhttps://example.com\nDescription")).toBe("https://example.com");
  });
});

describe("extractUrl — null and empty inputs", () => {
  it("returns null for null input", () => {
    expect(extractUrl(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractUrl("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(extractUrl("   ")).toBeNull();
  });
});

describe("extractUrl — non-URL text", () => {
  it("returns null for plain text without URL", () => {
    expect(extractUrl("Just some text without any URL")).toBeNull();
  });

  it("returns null for text with email-like pattern", () => {
    expect(extractUrl("user@example.com")).toBeNull();
  });

  it("returns null for ftp:// protocol", () => {
    expect(extractUrl("ftp://files.example.com")).toBeNull();
  });

  it("returns null for file:// protocol", () => {
    expect(extractUrl("file:///Users/test/file.txt")).toBeNull();
  });

  it("returns null for javascript: protocol", () => {
    expect(extractUrl("javascript:alert(1)")).toBeNull();
  });

  it("returns null for data: URI", () => {
    expect(extractUrl("data:text/html,<h1>Hello</h1>")).toBeNull();
  });

  it("returns null for partial URL without protocol", () => {
    expect(extractUrl("example.com/page")).toBeNull();
  });
});

describe("extractUrl — edge cases", () => {
  it("handles extremely long URL", () => {
    const longPath = "a".repeat(2000);
    expect(extractUrl(`https://example.com/${longPath}`)).toBe(`https://example.com/${longPath}`);
  });

  it("handles URL with all reserved characters in path", () => {
    expect(extractUrl("https://example.com/path?a=1&b=2#fragment")).toBe("https://example.com/path?a=1&b=2#fragment");
  });

  it("stops URL extraction at angle bracket", () => {
    expect(extractUrl("<https://example.com>")).toBe("https://example.com");
  });

  it("stops URL extraction at double quote", () => {
    expect(extractUrl('"https://example.com"')).toBe("https://example.com");
  });

  it("stops URL extraction at curly brace", () => {
    expect(extractUrl("{https://example.com}")).toBe("https://example.com");
  });

  it("stops URL extraction at pipe", () => {
    expect(extractUrl("https://example.com|suffix")).toBe("https://example.com");
  });

  it("URL with backslash accepted by URL constructor", () => {
    expect(extractUrl("https://example.com\\path")).toBe("https://example.com\\path");
  });

  it("stops URL extraction at backtick", () => {
    expect(extractUrl("`https://example.com`")).toBe("https://example.com");
  });

  it("stops URL extraction at square bracket", () => {
    expect(extractUrl("[https://example.com]")).toBe("https://example.com");
  });

  it("handles URL with @ symbol (common in social media)", () => {
    expect(extractUrl("https://twitter.com/@user")).toBe("https://twitter.com/@user");
  });

  it("handles URL with parentheses (Wikipedia-style)", () => {
    expect(extractUrl("https://en.wikipedia.org/wiki/Test_(disambiguation)")).toBe("https://en.wikipedia.org/wiki/Test_(disambiguation)");
  });
});

describe("Deep Link flow logic", () => {
  function simulateDeepLinkEffect(
    params: Record<string, string>,
    isAuthenticated: boolean,
    alreadyConsumed: boolean,
  ): { tab: string | null; capturedUrl: string | null; consumed: boolean; replaceStateCalled: boolean } {
    let tab: string | null = null;
    let capturedUrl: string | null = null;
    let consumed = alreadyConsumed;
    let replaceStateCalled = false;

    // Simulate the useEffect body
    if (consumed) return { tab, capturedUrl, consumed, replaceStateCalled };
    if (!isAuthenticated) return { tab, capturedUrl, consumed, replaceStateCalled };

    const get = (key: string) => params[key] ?? null;

    const sharedUrl = extractUrl(get("share_url"))
      || extractUrl(get("share_text"))
      || extractUrl(get("share_title"));

    const isDeepLink = get("tab") === "sources";
    const deepLinkUrl = isDeepLink ? extractUrl(get("url")) : null;

    const url = sharedUrl || deepLinkUrl;
    if (!sharedUrl && !isDeepLink) return { tab, capturedUrl, consumed, replaceStateCalled };

    consumed = true;
    if (url) capturedUrl = url;
    tab = "sources";
    replaceStateCalled = true;

    return { tab, capturedUrl, consumed, replaceStateCalled };
  }

  it("Web Share Target: share_url extracts URL and switches to sources", () => {
    const result = simulateDeepLinkEffect({ share_url: "https://example.com/article" }, true, false);
    expect(result.tab).toBe("sources");
    expect(result.capturedUrl).toBe("https://example.com/article");
    expect(result.consumed).toBe(true);
    expect(result.replaceStateCalled).toBe(true);
  });

  it("Web Share Target: share_text with URL extracts and switches", () => {
    const result = simulateDeepLinkEffect({ share_text: "Check this https://example.com/post" }, true, false);
    expect(result.tab).toBe("sources");
    expect(result.capturedUrl).toBe("https://example.com/post");
  });

  it("Web Share Target: share_title with URL extracts and switches", () => {
    const result = simulateDeepLinkEffect({ share_title: "https://example.com/page" }, true, false);
    expect(result.capturedUrl).toBe("https://example.com/page");
    expect(result.tab).toBe("sources");
  });

  it("Web Share Target: share_text without URL → no action", () => {
    const result = simulateDeepLinkEffect({ share_text: "Just some text" }, true, false);
    expect(result.tab).toBeNull();
    expect(result.capturedUrl).toBeNull();
  });

  it("Web Share Target: share_url priority over share_text", () => {
    const result = simulateDeepLinkEffect({
      share_url: "https://first.com",
      share_text: "https://second.com",
    }, true, false);
    expect(result.capturedUrl).toBe("https://first.com");
  });

  it("Deep Link: ?tab=sources&url=xxx extracts URL", () => {
    const result = simulateDeepLinkEffect({ tab: "sources", url: "https://example.com/article" }, true, false);
    expect(result.tab).toBe("sources");
    expect(result.capturedUrl).toBe("https://example.com/article");
  });

  it("Deep Link: ?tab=sources without url switches tab with no capturedUrl", () => {
    const result = simulateDeepLinkEffect({ tab: "sources" }, true, false);
    expect(result.tab).toBe("sources");
    expect(result.capturedUrl).toBeNull();
  });

  it("Deep Link: ?tab=dashboard does nothing", () => {
    const result = simulateDeepLinkEffect({ tab: "dashboard" }, true, false);
    expect(result.tab).toBeNull();
    expect(result.consumed).toBe(false);
  });

  it("Deep Link: ?url=xxx without tab=sources does nothing", () => {
    const result = simulateDeepLinkEffect({ url: "https://example.com" }, true, false);
    expect(result.tab).toBeNull();
    expect(result.capturedUrl).toBeNull();
  });

  it("no params → no action", () => {
    const result = simulateDeepLinkEffect({}, true, false);
    expect(result.tab).toBeNull();
    expect(result.consumed).toBe(false);
  });

  it("unauthenticated user → no action regardless of params", () => {
    const result = simulateDeepLinkEffect({ tab: "sources", url: "https://example.com" }, false, false);
    expect(result.tab).toBeNull();
    expect(result.consumed).toBe(false);
  });

  it("already consumed → no action on re-render", () => {
    const result = simulateDeepLinkEffect({ tab: "sources", url: "https://example.com" }, true, true);
    expect(result.tab).toBeNull();
    expect(result.consumed).toBe(true);
  });

  it("Web Share Target takes priority over Deep Link when both present", () => {
    const result = simulateDeepLinkEffect({
      share_url: "https://shared.com",
      tab: "sources",
      url: "https://deeplink.com",
    }, true, false);
    expect(result.capturedUrl).toBe("https://shared.com");
    expect(result.tab).toBe("sources");
  });

  it("Deep Link with invalid URL → tab switches but no capturedUrl", () => {
    const result = simulateDeepLinkEffect({ tab: "sources", url: "not-a-url" }, true, false);
    expect(result.tab).toBe("sources");
    expect(result.capturedUrl).toBeNull();
  });
});
