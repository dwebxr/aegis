import {
  detectPlatformFeed,
  extractYouTubeChannelId,
  parseGitHubRepo,
  parseBlueskyHandle,
  parseTwitterHandle,
  buildTopicFeedUrl,
} from "@/lib/sources/platformFeed";

describe("detectPlatformFeed", () => {
  const u = (s: string) => new URL(s);

  describe("YouTube", () => {
    it("detects /channel/UCxxx pattern", () => {
      const result = detectPlatformFeed(u("https://www.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ"));
      expect(result).not.toBeNull();
      expect(result!.feeds).toHaveLength(1);
      expect(result!.feeds[0]).toEqual({
        url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCddiUEpeqJcYeBxX1IVBKvQ",
        title: "YouTube Channel",
        type: "atom",
      });
    });

    it("detects /channel/UCxxx with trailing path segments", () => {
      const result = detectPlatformFeed(u("https://www.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ/videos"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toContain("channel_id=UCddiUEpeqJcYeBxX1IVBKvQ");
    });

    it("detects channel on m.youtube.com", () => {
      const result = detectPlatformFeed(u("https://m.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toContain("channel_id=UCddiUEpeqJcYeBxX1IVBKvQ");
    });

    it("detects channel with hyphen in ID", () => {
      const result = detectPlatformFeed(u("https://youtube.com/channel/UC-lHJZR3Gqxm24_Vd_AJ5Yw"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toContain("channel_id=UC-lHJZR3Gqxm24_Vd_AJ5Yw");
    });

    it("returns null for @handle (needs HTML fetch)", () => {
      expect(detectPlatformFeed(u("https://youtube.com/@VeritasiumEN"))).toBeNull();
    });

    it("returns null for /c/name (needs HTML fetch)", () => {
      expect(detectPlatformFeed(u("https://youtube.com/c/Veritasium"))).toBeNull();
    });

    it("returns null for YouTube home page", () => {
      expect(detectPlatformFeed(u("https://youtube.com/"))).toBeNull();
    });

    it("returns null for YouTube watch URL", () => {
      expect(detectPlatformFeed(u("https://youtube.com/watch?v=dQw4w9WgXcQ"))).toBeNull();
    });

    it("handles www.youtube.com (strips www.)", () => {
      const result = detectPlatformFeed(u("https://www.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ"));
      expect(result).not.toBeNull();
    });

    it("rejects non-UC channel ID pattern", () => {
      // /channel/ path but ID doesn't start with UC
      expect(detectPlatformFeed(u("https://youtube.com/channel/PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"))).toBeNull();
    });
  });

  describe("GitHub", () => {
    it("detects owner/repo", () => {
      const result = detectPlatformFeed(u("https://github.com/vercel/next.js"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0]).toEqual({
        url: "https://github.com/vercel/next.js/releases.atom",
        title: "vercel/next.js Releases",
        type: "atom",
      });
    });

    it("detects owner/repo with trailing slash", () => {
      const result = detectPlatformFeed(u("https://github.com/vercel/next.js/"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://github.com/vercel/next.js/releases.atom");
    });

    it("detects owner/repo/releases path", () => {
      const result = detectPlatformFeed(u("https://github.com/vercel/next.js/releases"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://github.com/vercel/next.js/releases.atom");
    });

    it("detects owner/repo/releases/ with trailing slash", () => {
      const result = detectPlatformFeed(u("https://github.com/vercel/next.js/releases/"));
      expect(result).not.toBeNull();
    });

    it("strips .git suffix", () => {
      const result = detectPlatformFeed(u("https://github.com/vercel/next.js.git"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://github.com/vercel/next.js/releases.atom");
      expect(result!.feeds[0].title).toBe("vercel/next.js Releases");
    });

    it("rejects reserved path: /owner/settings", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel/settings"))).toBeNull();
    });

    it("rejects reserved path: /owner/issues", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel/issues"))).toBeNull();
    });

    it("rejects reserved path: /owner/pulls", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel/pulls"))).toBeNull();
    });

    it("rejects reserved path: /owner/actions", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel/actions"))).toBeNull();
    });

    it("rejects reserved path: /owner/wiki", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel/wiki"))).toBeNull();
    });

    it("rejects reserved path: /owner/discussions", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel/discussions"))).toBeNull();
    });

    it("rejects deep path /owner/repo/tree/main", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel/next.js/tree/main"))).toBeNull();
    });

    it("rejects GitHub profile (single segment)", () => {
      expect(detectPlatformFeed(u("https://github.com/vercel"))).toBeNull();
    });

    it("rejects GitHub home page", () => {
      expect(detectPlatformFeed(u("https://github.com/"))).toBeNull();
    });
  });

  describe("Bluesky", () => {
    it("detects /profile/handle.bsky.social", () => {
      const result = detectPlatformFeed(u("https://bsky.app/profile/jay.bsky.social"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0]).toEqual({
        url: "https://bsky.app/profile/jay.bsky.social/rss",
        title: "Bluesky: @jay.bsky.social",
        type: "rss",
      });
    });

    it("detects /profile/handle with trailing slash", () => {
      const result = detectPlatformFeed(u("https://bsky.app/profile/jay.bsky.social/"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://bsky.app/profile/jay.bsky.social/rss");
    });

    it("detects custom domain handle", () => {
      const result = detectPlatformFeed(u("https://bsky.app/profile/example.com"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://bsky.app/profile/example.com/rss");
    });

    it("rejects /profile/handle/post/xxx (deep path)", () => {
      expect(detectPlatformFeed(u("https://bsky.app/profile/jay.bsky.social/post/abc123"))).toBeNull();
    });

    it("rejects bsky.app home page", () => {
      expect(detectPlatformFeed(u("https://bsky.app/"))).toBeNull();
    });

    it("rejects bsky.app/search", () => {
      expect(detectPlatformFeed(u("https://bsky.app/search"))).toBeNull();
    });
  });

  describe("Twitter/X", () => {
    it("detects x.com handle and returns RSSHub URL", () => {
      const result = detectPlatformFeed(u("https://x.com/elonmusk"));
      expect(result).not.toBeNull();
      expect(result!.feeds).toHaveLength(1);
      expect(result!.feeds[0]).toEqual({
        url: "https://rsshub.app/twitter/user/elonmusk",
        title: "X: @elonmusk",
        type: "rss",
      });
    });

    it("detects twitter.com handle", () => {
      const result = detectPlatformFeed(u("https://twitter.com/user123"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://rsshub.app/twitter/user/user123");
    });

    it("detects handle with trailing slash", () => {
      const result = detectPlatformFeed(u("https://x.com/elonmusk/"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://rsshub.app/twitter/user/elonmusk");
    });

    it("strips www. prefix", () => {
      const result = detectPlatformFeed(u("https://www.x.com/elonmusk"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toContain("elonmusk");
    });

    it("rejects reserved path: /home", () => {
      expect(detectPlatformFeed(u("https://x.com/home"))).toBeNull();
    });

    it("rejects reserved path: /explore", () => {
      expect(detectPlatformFeed(u("https://x.com/explore"))).toBeNull();
    });

    it("rejects reserved path: /notifications", () => {
      expect(detectPlatformFeed(u("https://x.com/notifications"))).toBeNull();
    });

    it("rejects reserved path: /messages", () => {
      expect(detectPlatformFeed(u("https://x.com/messages"))).toBeNull();
    });

    it("rejects reserved path: /search", () => {
      expect(detectPlatformFeed(u("https://x.com/search"))).toBeNull();
    });

    it("rejects reserved path: /settings", () => {
      expect(detectPlatformFeed(u("https://x.com/settings"))).toBeNull();
    });

    it("rejects reserved path: /i", () => {
      expect(detectPlatformFeed(u("https://x.com/i"))).toBeNull();
    });

    it("rejects reserved path: /compose", () => {
      expect(detectPlatformFeed(u("https://x.com/compose"))).toBeNull();
    });

    it("rejects deep path /user/status/123", () => {
      expect(detectPlatformFeed(u("https://x.com/elonmusk/status/123456"))).toBeNull();
    });

    it("rejects x.com root", () => {
      expect(detectPlatformFeed(u("https://x.com/"))).toBeNull();
    });
  });

  describe("non-matching URLs", () => {
    it("returns null for generic websites", () => {
      expect(detectPlatformFeed(u("https://example.com/blog"))).toBeNull();
    });

    it("returns null for Reddit", () => {
      expect(detectPlatformFeed(u("https://reddit.com/r/programming"))).toBeNull();
    });

    it("returns null for Mastodon", () => {
      expect(detectPlatformFeed(u("https://mastodon.social/@user"))).toBeNull();
    });
  });
});

describe("extractYouTubeChannelId", () => {
  it("extracts from externalId JSON field", () => {
    const html = `<script>var ytInitialData = {"externalId":"UCddiUEpeqJcYeBxX1IVBKvQ","title":"Veritasium"}</script>`;
    expect(extractYouTubeChannelId(html)).toBe("UCddiUEpeqJcYeBxX1IVBKvQ");
  });

  it("extracts from channelId JSON field", () => {
    const html = `{"channelId":"UC-lHJZR3Gqxm24_Vd_AJ5Yw","vanityUrl":"3Blue1Brown"}`;
    expect(extractYouTubeChannelId(html)).toBe("UC-lHJZR3Gqxm24_Vd_AJ5Yw");
  });

  it("extracts from itemprop meta tag", () => {
    const html = `<meta itemprop="channelId" content="UCddiUEpeqJcYeBxX1IVBKvQ">`;
    expect(extractYouTubeChannelId(html)).toBe("UCddiUEpeqJcYeBxX1IVBKvQ");
  });

  it("extracts from canonical link tag", () => {
    const html = `<link rel="canonical" href="https://www.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ">`;
    expect(extractYouTubeChannelId(html)).toBe("UCddiUEpeqJcYeBxX1IVBKvQ");
  });

  it("extracts from http canonical link", () => {
    const html = `<link rel="canonical" href="http://www.youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ">`;
    expect(extractYouTubeChannelId(html)).toBe("UCddiUEpeqJcYeBxX1IVBKvQ");
  });

  it("prefers externalId over itemprop", () => {
    const html = `
      <script>{"externalId":"UCaaa-BBB1234567890"}</script>
      <meta itemprop="channelId" content="UCxxx-YYY0987654321">
    `;
    expect(extractYouTubeChannelId(html)).toBe("UCaaa-BBB1234567890");
  });

  it("falls back to itemprop when externalId missing", () => {
    const html = `
      <script>{"otherField":"value"}</script>
      <meta itemprop="channelId" content="UCxxx-YYY0987654321">
    `;
    expect(extractYouTubeChannelId(html)).toBe("UCxxx-YYY0987654321");
  });

  it("falls back to canonical when others missing", () => {
    const html = `
      <head>
        <title>Some Channel</title>
        <link rel="canonical" href="https://www.youtube.com/channel/UCfinal_Fallback123">
      </head>
    `;
    expect(extractYouTubeChannelId(html)).toBe("UCfinal_Fallback123");
  });

  it("returns null when no channel ID found", () => {
    const html = `<html><head><title>YouTube</title></head><body>No channel info</body></html>`;
    expect(extractYouTubeChannelId(html)).toBeNull();
  });

  it("returns null for empty HTML", () => {
    expect(extractYouTubeChannelId("")).toBeNull();
  });

  it("returns null when ID doesn't start with UC", () => {
    const html = `<script>{"externalId":"PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"}</script>`;
    expect(extractYouTubeChannelId(html)).toBeNull();
  });

  it("handles channel ID with underscores and hyphens", () => {
    const html = `{"channelId":"UC_x5XG1OV2P6uZZ5FSM9Ttw"}`;
    expect(extractYouTubeChannelId(html)).toBe("UC_x5XG1OV2P6uZZ5FSM9Ttw");
  });

  it("handles whitespace around colon in JSON", () => {
    const html = `"externalId" : "UCabcdef123456789012345"`;
    expect(extractYouTubeChannelId(html)).toBe("UCabcdef123456789012345");
  });
});

describe("parseGitHubRepo", () => {
  it("parses owner/repo shorthand", () => {
    expect(parseGitHubRepo("vercel/next.js")).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("parses full GitHub URL", () => {
    expect(parseGitHubRepo("https://github.com/vercel/next.js")).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("parses GitHub URL with trailing slash", () => {
    expect(parseGitHubRepo("https://github.com/vercel/next.js/")).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("strips .git suffix from URL", () => {
    expect(parseGitHubRepo("https://github.com/vercel/next.js.git")).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("strips .git suffix from shorthand", () => {
    // shorthand doesn't go through URL regex; .git remains in repo name
    const result = parseGitHubRepo("vercel/next.js.git");
    // This is a shorthand, not URL, so .git is part of repo name
    expect(result).toEqual({ owner: "vercel", repo: "next.js.git" });
  });

  it("parses http URL", () => {
    expect(parseGitHubRepo("http://github.com/vercel/next.js")).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("parses URL with deeper path segment (match extracts first two segments)", () => {
    const result = parseGitHubRepo("https://github.com/vercel/next.js/tree/main");
    expect(result).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("handles repo with dots in name", () => {
    expect(parseGitHubRepo("owner/my.dotted.repo")).toEqual({ owner: "owner", repo: "my.dotted.repo" });
  });

  it("handles repo with hyphens", () => {
    expect(parseGitHubRepo("my-org/my-repo")).toEqual({ owner: "my-org", repo: "my-repo" });
  });

  it("rejects single name (no slash)", () => {
    const result = parseGitHubRepo("vercel");
    expect(result).toEqual({ error: "Enter as owner/repo (e.g. vercel/next.js)" });
  });

  it("rejects empty string", () => {
    const result = parseGitHubRepo("");
    expect(result).toEqual({ error: "Enter as owner/repo (e.g. vercel/next.js)" });
  });

  it("rejects too many segments (without github.com)", () => {
    const result = parseGitHubRepo("a/b/c");
    expect(result).toEqual({ error: "Enter as owner/repo (e.g. vercel/next.js)" });
  });

  it("rejects github.com without repo path", () => {
    const result = parseGitHubRepo("https://github.com/vercel");
    expect(result).toEqual({ error: "Invalid GitHub URL" });
  });

  it("rejects github.com root", () => {
    const result = parseGitHubRepo("https://github.com/");
    expect(result).toEqual({ error: "Invalid GitHub URL" });
  });

  it("rejects just slashes", () => {
    const result = parseGitHubRepo("///");
    expect(result).toEqual({ error: "Enter as owner/repo (e.g. vercel/next.js)" });
  });
});

describe("parseBlueskyHandle", () => {
  it("parses bare handle with domain", () => {
    expect(parseBlueskyHandle("jay.bsky.social")).toBe("jay.bsky.social");
  });

  it("parses @handle with domain", () => {
    expect(parseBlueskyHandle("@jay.bsky.social")).toBe("jay.bsky.social");
  });

  it("appends .bsky.social to bare name", () => {
    expect(parseBlueskyHandle("jay")).toBe("jay.bsky.social");
  });

  it("appends .bsky.social to @name", () => {
    expect(parseBlueskyHandle("@jay")).toBe("jay.bsky.social");
  });

  it("preserves custom domain handle", () => {
    expect(parseBlueskyHandle("example.com")).toBe("example.com");
  });

  it("extracts handle from bsky.app profile URL", () => {
    expect(parseBlueskyHandle("https://bsky.app/profile/jay.bsky.social")).toBe("jay.bsky.social");
  });

  it("extracts handle from bsky.app profile URL with trailing slash", () => {
    // Trailing slash becomes part of match but the regex [^/\s]+ won't include it
    expect(parseBlueskyHandle("https://bsky.app/profile/jay.bsky.social/")).toBe("jay.bsky.social");
  });

  it("extracts custom domain from bsky.app URL", () => {
    expect(parseBlueskyHandle("https://bsky.app/profile/example.com")).toBe("example.com");
  });

  it("handles did:plc identifier", () => {
    expect(parseBlueskyHandle("did:plc:abc123")).toBe("did:plc:abc123");
  });

  it("does not double-append .bsky.social to domain handle", () => {
    expect(parseBlueskyHandle("user.bsky.social")).toBe("user.bsky.social");
  });

  it("strips @ from handle with subdomain", () => {
    expect(parseBlueskyHandle("@user.example.com")).toBe("user.example.com");
  });
});

describe("parseTwitterHandle", () => {
  it("strips @ prefix", () => {
    expect(parseTwitterHandle("@elonmusk")).toBe("elonmusk");
  });

  it("returns bare username as-is", () => {
    expect(parseTwitterHandle("username")).toBe("username");
  });

  it("extracts handle from x.com URL", () => {
    expect(parseTwitterHandle("https://x.com/elonmusk")).toBe("elonmusk");
  });

  it("extracts handle from twitter.com URL", () => {
    expect(parseTwitterHandle("https://twitter.com/user123")).toBe("user123");
  });

  it("extracts handle from x.com URL with query params", () => {
    expect(parseTwitterHandle("https://x.com/elonmusk?ref=home")).toBe("elonmusk");
  });

  it("handles x.com URL with trailing slash", () => {
    // The regex [^/?\s]+ stops at /, so trailing slash is excluded
    expect(parseTwitterHandle("https://x.com/user/")).toBe("user");
  });

  it("trims whitespace", () => {
    expect(parseTwitterHandle("  @elonmusk  ")).toBe("elonmusk");
  });

  it("handles @ with URL (strips @ from extracted handle)", () => {
    // URL extraction takes precedence, @ only stripped if still present
    expect(parseTwitterHandle("https://x.com/@elonmusk")).toBe("elonmusk");
  });
});

describe("buildTopicFeedUrl", () => {
  it("builds URL for simple keyword", () => {
    expect(buildTopicFeedUrl("AI safety")).toBe(
      "https://news.google.com/rss/search?q=AI%20safety&hl=en"
    );
  });

  it("encodes special characters", () => {
    expect(buildTopicFeedUrl("C++ programming")).toBe(
      "https://news.google.com/rss/search?q=C%2B%2B%20programming&hl=en"
    );
  });

  it("encodes ampersand", () => {
    expect(buildTopicFeedUrl("AI & ML")).toBe(
      "https://news.google.com/rss/search?q=AI%20%26%20ML&hl=en"
    );
  });

  it("encodes unicode characters", () => {
    const url = buildTopicFeedUrl("人工知能");
    expect(url).toContain("news.google.com/rss/search?q=");
    expect(url).toContain("&hl=en");
    // Verify it's properly encoded
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("人工知能");
  });

  it("handles comma-separated keywords", () => {
    const url = buildTopicFeedUrl("AI safety, machine learning");
    expect(url).toBe(
      "https://news.google.com/rss/search?q=AI%20safety%2C%20machine%20learning&hl=en"
    );
  });

  it("handles empty string", () => {
    const url = buildTopicFeedUrl("");
    expect(url).toBe("https://news.google.com/rss/search?q=&hl=en");
  });

  it("handles quoted phrases", () => {
    const url = buildTopicFeedUrl('"exact phrase"');
    expect(url).toContain("news.google.com/rss/search?q=");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe('"exact phrase"');
  });

  it("always includes hl=en parameter", () => {
    const url = buildTopicFeedUrl("test");
    expect(url).toMatch(/&hl=en$/);
  });
});
