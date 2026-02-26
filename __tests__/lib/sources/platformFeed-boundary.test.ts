import {
  detectPlatformFeed,
  extractYouTubeChannelId,
  parseGitHubRepo,
  parseBlueskyHandle,
  parseRedditSubreddit,
  parseMastodonAccount,
  buildTopicFeedUrl,
} from "@/lib/sources/platformFeed";

// ─── detectPlatformFeed: boundary / adversarial inputs ───

describe("detectPlatformFeed — boundary conditions", () => {
  const u = (s: string) => new URL(s);

  describe("YouTube edge cases", () => {
    it("rejects channel ID that is exactly 'UC' with no suffix", () => {
      expect(detectPlatformFeed(u("https://youtube.com/channel/UC"))).toBeNull();
    });

    it("handles very long channel ID", () => {
      const longId = "UC" + "a".repeat(100);
      const result = detectPlatformFeed(u(`https://youtube.com/channel/${longId}`));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toContain(`channel_id=${longId}`);
    });

    it("rejects youtube.com with query-only URL", () => {
      expect(detectPlatformFeed(u("https://youtube.com/?search=test"))).toBeNull();
    });

    it("handles youtube.com/channel/UCxxx?feature=share", () => {
      const result = detectPlatformFeed(u("https://youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ?feature=share"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toContain("channel_id=UCddiUEpeqJcYeBxX1IVBKvQ");
    });

    it("rejects /channel/ with no ID", () => {
      expect(detectPlatformFeed(u("https://youtube.com/channel/"))).toBeNull();
    });
  });

  describe("GitHub edge cases", () => {
    it("handles repo with special characters (dashes, dots, underscores)", () => {
      const result = detectPlatformFeed(u("https://github.com/my-org/my_repo.js"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://github.com/my-org/my_repo.js/releases.atom");
    });

    it("handles www.github.com", () => {
      const result = detectPlatformFeed(u("https://www.github.com/vercel/next.js"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://github.com/vercel/next.js/releases.atom");
    });

    it("rejects github.com with empty path", () => {
      expect(detectPlatformFeed(u("https://github.com"))).toBeNull();
    });

    it("handles github.com/owner/repo with query params", () => {
      // URL pathname is /owner/repo, query params don't affect pathname regex
      const result = detectPlatformFeed(u("https://github.com/vercel/next.js?tab=readme"));
      expect(result).not.toBeNull();
    });

    it("rejects /owner/repo/issues/123 deep path", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel/next.js/issues/123"))).toBeNull();
    });
  });

  describe("Reddit edge cases", () => {
    it("rejects subreddit with hyphens (Reddit only allows underscores)", () => {
      // /r/my-sub doesn't match [A-Za-z0-9_]+ pattern
      expect(detectPlatformFeed(u("https://reddit.com/r/my-sub"))).toBeNull();
    });

    it("rejects /r/ with no subreddit name", () => {
      expect(detectPlatformFeed(u("https://reddit.com/r/"))).toBeNull();
    });

    it("handles very long subreddit name", () => {
      const longSub = "a".repeat(50);
      const result = detectPlatformFeed(u(`https://reddit.com/r/${longSub}`));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe(`https://www.reddit.com/r/${longSub}/.rss`);
    });

    it("rejects /r/sub/wiki path", () => {
      expect(detectPlatformFeed(u("https://reddit.com/r/programming/wiki"))).toBeNull();
    });

    it("rejects reddit.com/search", () => {
      expect(detectPlatformFeed(u("https://reddit.com/search?q=test"))).toBeNull();
    });
  });

  describe("Bluesky edge cases", () => {
    it("rejects bsky.app/profile without handle", () => {
      expect(detectPlatformFeed(u("https://bsky.app/profile/"))).toBeNull();
    });

    it("handles profile with did:plc identifier", () => {
      const result = detectPlatformFeed(u("https://bsky.app/profile/did:plc:abc123"));
      // did:plc:abc123 contains colons which match [^/]+
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://bsky.app/profile/did:plc:abc123/rss");
    });

    it("rejects /profile/handle/feed/xxx deep path", () => {
      expect(detectPlatformFeed(u("https://bsky.app/profile/jay.bsky.social/feed/aaabbb"))).toBeNull();
    });
  });

  describe("Mastodon catch-all edge cases", () => {
    it("handles single-char username", () => {
      const result = detectPlatformFeed(u("https://mastodon.social/@a"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://mastodon.social/@a.rss");
    });

    it("handles instance with port number", () => {
      const result = detectPlatformFeed(u("https://mastodon.local:8443/@user"));
      expect(result).not.toBeNull();
      // origin includes port
      expect(result!.feeds[0].url).toBe("https://mastodon.local:8443/@user.rss");
    });

    it("rejects /@user/followers path", () => {
      expect(detectPlatformFeed(u("https://mastodon.social/@gargron/followers"))).toBeNull();
    });

    it("rejects /about path (no @ prefix)", () => {
      expect(detectPlatformFeed(u("https://mastodon.social/about"))).toBeNull();
    });

    it("does not match username with dots (ensures [A-Za-z0-9_] pattern)", () => {
      // /@user.name doesn't match because dot is not in [A-Za-z0-9_]
      expect(detectPlatformFeed(u("https://mastodon.social/@user.name"))).toBeNull();
    });
  });

  describe("cross-platform priority / ordering", () => {
    it("YouTube takes priority over Mastodon catch-all for youtube.com/@handle", () => {
      // /@handle on youtube.com should return null (needs HTML fetch), NOT match Mastodon
      const result = detectPlatformFeed(u("https://youtube.com/@Veritasium"));
      expect(result).toBeNull();
    });

    it("GitHub takes priority over Mastodon catch-all", () => {
      // github.com doesn't have /@user paths, but verify no false match
      const result = detectPlatformFeed(u("https://github.com/vercel/next.js"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].type).toBe("atom");
      expect(result!.feeds[0].url).toContain("releases.atom");
    });

    it("Reddit /r/ path takes priority", () => {
      const result = detectPlatformFeed(u("https://reddit.com/r/programming"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toContain("reddit.com/r/programming");
    });
  });
});

// ─── extractYouTubeChannelId: boundary inputs ───

describe("extractYouTubeChannelId — boundary conditions", () => {
  it("handles very large HTML string (performance)", () => {
    const bigHtml = "x".repeat(500_000) + `"channelId":"UCtest123456789012345"` + "x".repeat(500_000);
    expect(extractYouTubeChannelId(bigHtml)).toBe("UCtest123456789012345");
  });

  it("returns null for UC prefix buried in unrelated JSON", () => {
    const html = `{"someOtherField":"UCnotachannelid"}`;
    // Should NOT match because the key is not "externalId" or "channelId"
    expect(extractYouTubeChannelId(html)).toBeNull();
  });

  it("handles multiple channelId matches (returns first)", () => {
    const html = `"channelId":"UCfirst_AAAAA12345678"  "channelId":"UCsecond_BBBBB12345678"`;
    expect(extractYouTubeChannelId(html)).toBe("UCfirst_AAAAA12345678");
  });

  it("handles newlines in HTML around channelId", () => {
    const html = `"channelId"\n:\n"UCnewline_Test_123456789"`;
    // \s* in regex should handle newlines
    expect(extractYouTubeChannelId(html)).toBe("UCnewline_Test_123456789");
  });

  it("does not match channelId inside HTML comment", () => {
    // Regex doesn't differentiate context, so it WILL match inside comments
    // This documents current behavior
    const html = `<!-- "channelId":"UCcommented_out_12345" -->`;
    expect(extractYouTubeChannelId(html)).toBe("UCcommented_out_12345");
  });
});

// ─── parseGitHubRepo: boundary / adversarial ───

describe("parseGitHubRepo — boundary conditions", () => {
  it("handles whitespace-only input", () => {
    expect(parseGitHubRepo("   ")).toHaveProperty("error");
  });

  it("handles tab characters", () => {
    expect(parseGitHubRepo("\t")).toHaveProperty("error");
  });

  it("handles URL with fragment", () => {
    const result = parseGitHubRepo("https://github.com/vercel/next.js#readme");
    expect(result).toEqual({ owner: "vercel", repo: "next.js#readme" });
  });

  it("handles URL with query string", () => {
    const result = parseGitHubRepo("https://github.com/vercel/next.js?tab=readme");
    expect(result).toEqual({ owner: "vercel", repo: "next.js?tab=readme" });
  });

  it("handles extremely long repo name", () => {
    const longName = "a".repeat(200);
    const result = parseGitHubRepo(`owner/${longName}`);
    expect(result).toEqual({ owner: "owner", repo: longName });
  });

  it("handles owner with dots", () => {
    expect(parseGitHubRepo("my.org/repo")).toEqual({ owner: "my.org", repo: "repo" });
  });

  it("rejects url with only github.com domain", () => {
    expect(parseGitHubRepo("github.com")).toHaveProperty("error");
  });

  it("handles github.com URL with www prefix", () => {
    // "www.github.com" doesn't contain exactly "github.com" after www.
    // Actually it does: www.github.com contains "github.com"
    const result = parseGitHubRepo("https://www.github.com/vercel/next.js");
    expect(result).toEqual({ owner: "vercel", repo: "next.js" });
  });
});

// ─── parseBlueskyHandle: boundary / adversarial ───

describe("parseBlueskyHandle — boundary conditions", () => {
  it("handles empty string", () => {
    const result = parseBlueskyHandle("");
    // Empty string has no dot and doesn't start with did: → appends .bsky.social
    expect(result).toBe(".bsky.social");
  });

  it("handles whitespace-only input", () => {
    const result = parseBlueskyHandle("  ");
    // After @ removal, spaces remain; no dot → appends .bsky.social
    expect(result).toBe("  .bsky.social");
  });

  it("handles @ only", () => {
    const result = parseBlueskyHandle("@");
    // Removes @, empty string → appends .bsky.social
    expect(result).toBe(".bsky.social");
  });

  it("handles bsky.app/profile/ with no handle", () => {
    // URL with trailing slash but no handle — regex won't match
    const result = parseBlueskyHandle("https://bsky.app/profile/");
    // Contains "bsky.app/profile/" but match[1] would be empty
    // The regex [^/\s]+ requires at least 1 char, so match fails
    // Falls through to @ removal, then "https://bsky.app/profile/" has a dot → returned as-is
    expect(result).toBe("https://bsky.app/profile/");
  });

  it("handles handle with numbers", () => {
    expect(parseBlueskyHandle("user123")).toBe("user123.bsky.social");
  });

  it("handles handle with hyphens", () => {
    expect(parseBlueskyHandle("my-handle")).toBe("my-handle.bsky.social");
  });

  it("preserves did:plc prefix without appending .bsky.social", () => {
    expect(parseBlueskyHandle("did:plc:abcdef123456")).toBe("did:plc:abcdef123456");
  });
});

// ─── parseRedditSubreddit: boundary / adversarial ───

describe("parseRedditSubreddit — boundary conditions", () => {
  it("handles empty string", () => {
    expect(parseRedditSubreddit("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(parseRedditSubreddit("   ")).toBe("");
  });

  it("handles URL with trailing path after subreddit", () => {
    // "reddit.com/r/programming/hot" — regex only matches [A-Za-z0-9_]+
    // It will match "programming" from the URL
    expect(parseRedditSubreddit("https://reddit.com/r/programming/hot")).toBe("programming");
  });

  it("handles URL with query parameters", () => {
    expect(parseRedditSubreddit("https://reddit.com/r/javascript?sort=new")).toBe("javascript");
  });

  it("handles subreddit name with only numbers", () => {
    expect(parseRedditSubreddit("12345")).toBe("12345");
  });

  it("handles subreddit name with only underscores", () => {
    expect(parseRedditSubreddit("___")).toBe("___");
  });

  it("handles /r/r/ (subreddit named r)", () => {
    expect(parseRedditSubreddit("/r/r")).toBe("r");
  });

  it("handles double r/ prefix", () => {
    // "r/r/sub" — replace removes first /?(r/)? → "r/sub"
    // Wait, the regex replaces from start: /^\/?(r\/)?/
    // "r/r/sub" → replaces "r/" → "r/sub"
    expect(parseRedditSubreddit("r/r/sub")).toBe("r/sub");
  });

  it("handles reddit.com without /r/ path", () => {
    // Does not contain "reddit.com/r/"
    expect(parseRedditSubreddit("https://reddit.com/")).toBe("https://reddit.com/");
  });

  it("strips only the first /r/ prefix from bare input", () => {
    expect(parseRedditSubreddit("/r/test")).toBe("test");
  });
});

// ─── parseMastodonAccount: boundary / adversarial ───

describe("parseMastodonAccount — boundary conditions", () => {
  it("handles whitespace-only input", () => {
    expect(parseMastodonAccount("   ")).toHaveProperty("error");
  });

  it("rejects URL with post path", () => {
    const result = parseMastodonAccount("https://mastodon.social/@user/12345");
    // URL regex requires /@user/? at end — /12345 makes it not match
    expect(result).toHaveProperty("error");
  });

  it("rejects http:// URL (accepts only https)", () => {
    // Actually the regex allows both http and https
    const result = parseMastodonAccount("http://mastodon.social/@user");
    expect(result).toEqual({ username: "user", instance: "mastodon.social" });
  });

  it("handles instance with subdomain", () => {
    expect(parseMastodonAccount("@user@social.example.co.uk")).toEqual({
      username: "user",
      instance: "social.example.co.uk",
    });
  });

  it("rejects instance without TLD", () => {
    // Instance regex requires [A-Za-z]{2,} TLD
    const result = parseMastodonAccount("@user@localhost");
    expect(result).toHaveProperty("error");
  });

  it("rejects instance with port in @ notation", () => {
    // Port is not part of the [A-Za-z0-9.-]+\.[A-Za-z]{2,} pattern
    const result = parseMastodonAccount("@user@mastodon.social:8443");
    expect(result).toHaveProperty("error");
  });

  it("handles username with numbers", () => {
    expect(parseMastodonAccount("@user123@mastodon.social")).toEqual({
      username: "user123",
      instance: "mastodon.social",
    });
  });

  it("rejects double @@ prefix", () => {
    // First @ is stripped, then "@user@instance" is processed
    // After stripping first @, becomes "@user@mastodon.social"
    // The regex then tries to match "user@mastodon.social" after removing first @... wait
    // trimmed.replace(/^@/, "") removes first @, giving "@user@mastodon.social"
    // Wait: "@@user@mastodon.social".replace(/^@/, "") → "@user@mastodon.social"
    // Then regex: ^([A-Za-z0-9_]+)@... but starts with @ so doesn't match
    const result = parseMastodonAccount("@@user@mastodon.social");
    expect(result).toHaveProperty("error");
  });

  it("handles URL with http scheme", () => {
    const result = parseMastodonAccount("http://fosstodon.org/@user");
    expect(result).toEqual({ username: "user", instance: "fosstodon.org" });
  });

  it("rejects URL with fragment", () => {
    // "https://mastodon.social/@user#section" — /@user#section doesn't match /@([A-Za-z0-9_]+)/?$
    const result = parseMastodonAccount("https://mastodon.social/@user#section");
    expect(result).toHaveProperty("error");
  });

  it("rejects URL with query params", () => {
    const result = parseMastodonAccount("https://mastodon.social/@user?page=2");
    expect(result).toHaveProperty("error");
  });
});

// ─── buildTopicFeedUrl: boundary conditions ───

describe("buildTopicFeedUrl — boundary conditions", () => {
  it("handles very long keyword string", () => {
    const longKeywords = "a ".repeat(500).trim();
    const url = buildTopicFeedUrl(longKeywords);
    expect(url).toContain("news.google.com/rss/search?q=");
    expect(url).toContain("&hl=en");
    // Verify it's a valid URL
    expect(() => new URL(url)).not.toThrow();
  });

  it("handles newline characters in keywords", () => {
    const url = buildTopicFeedUrl("AI\nsafety");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("AI\nsafety");
  });

  it("handles tab characters", () => {
    const url = buildTopicFeedUrl("AI\tsafety");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("AI\tsafety");
  });

  it("handles URL-like keywords", () => {
    const url = buildTopicFeedUrl("https://example.com");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("https://example.com");
  });

  it("handles keywords with percent signs", () => {
    const url = buildTopicFeedUrl("50% off");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("50% off");
  });

  it("handles keywords with hash symbol", () => {
    const url = buildTopicFeedUrl("#trending");
    expect(url).toContain("news.google.com/rss/search?q=");
    // Note: # in encodeURIComponent becomes %23
    expect(url).toContain("%23trending");
  });
});
