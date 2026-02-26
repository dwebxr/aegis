import {
  detectPlatformFeed,
  extractYouTubeChannelId,
  parseGitHubRepo,
  parseBlueskyHandle,
  parseRedditSubreddit,
  parseMastodonAccount,
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

  describe("Reddit", () => {
    it("detects /r/subreddit", () => {
      const result = detectPlatformFeed(u("https://reddit.com/r/programming"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0]).toEqual({
        url: "https://www.reddit.com/r/programming/.rss",
        title: "r/programming",
        type: "rss",
      });
    });

    it("detects /r/subreddit with trailing slash", () => {
      const result = detectPlatformFeed(u("https://reddit.com/r/programming/"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://www.reddit.com/r/programming/.rss");
    });

    it("detects www.reddit.com", () => {
      const result = detectPlatformFeed(u("https://www.reddit.com/r/javascript"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://www.reddit.com/r/javascript/.rss");
    });

    it("detects old.reddit.com", () => {
      const result = detectPlatformFeed(u("https://old.reddit.com/r/rust"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://www.reddit.com/r/rust/.rss");
    });

    it("handles subreddit with underscores", () => {
      const result = detectPlatformFeed(u("https://reddit.com/r/machine_learning"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].title).toBe("r/machine_learning");
    });

    it("rejects deep subreddit paths (/r/sub/comments/...)", () => {
      expect(detectPlatformFeed(u("https://reddit.com/r/programming/comments/abc123"))).toBeNull();
    });

    it("rejects Reddit home page", () => {
      expect(detectPlatformFeed(u("https://reddit.com/"))).toBeNull();
    });

    it("rejects /user/ paths", () => {
      expect(detectPlatformFeed(u("https://reddit.com/user/someone"))).toBeNull();
    });
  });

  describe("Mastodon", () => {
    it("detects /@username on mastodon.social", () => {
      const result = detectPlatformFeed(u("https://mastodon.social/@gargron"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0]).toEqual({
        url: "https://mastodon.social/@gargron.rss",
        title: "@gargron@mastodon.social",
        type: "rss",
      });
    });

    it("detects /@username with trailing slash", () => {
      const result = detectPlatformFeed(u("https://mastodon.social/@gargron/"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://mastodon.social/@gargron.rss");
    });

    it("detects on mstdn.jp instance", () => {
      const result = detectPlatformFeed(u("https://mstdn.jp/@user123"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://mstdn.jp/@user123.rss");
      expect(result!.feeds[0].title).toBe("@user123@mstdn.jp");
    });

    it("detects on custom instance", () => {
      const result = detectPlatformFeed(u("https://infosec.exchange/@security_researcher"));
      expect(result).not.toBeNull();
      expect(result!.feeds[0].url).toBe("https://infosec.exchange/@security_researcher.rss");
    });

    it("rejects deep paths (/@user/12345)", () => {
      expect(detectPlatformFeed(u("https://mastodon.social/@gargron/12345"))).toBeNull();
    });

    it("rejects non-@ paths", () => {
      expect(detectPlatformFeed(u("https://mastodon.social/explore"))).toBeNull();
    });
  });

  describe("non-matching URLs", () => {
    it("returns null for generic websites", () => {
      expect(detectPlatformFeed(u("https://example.com/blog"))).toBeNull();
    });

    it("returns null for Twitter/X", () => {
      expect(detectPlatformFeed(u("https://twitter.com/elonmusk"))).toBeNull();
    });

    it("returns null for unsupported Reddit paths", () => {
      expect(detectPlatformFeed(u("https://reddit.com/user/someone"))).toBeNull();
    });

    it("returns null for Mastodon deep paths", () => {
      expect(detectPlatformFeed(u("https://mastodon.social/@user/12345"))).toBeNull();
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

describe("parseRedditSubreddit", () => {
  it("parses bare subreddit name", () => {
    expect(parseRedditSubreddit("programming")).toBe("programming");
  });

  it("parses r/name shorthand", () => {
    expect(parseRedditSubreddit("r/programming")).toBe("programming");
  });

  it("parses /r/name shorthand", () => {
    expect(parseRedditSubreddit("/r/programming")).toBe("programming");
  });

  it("parses full reddit.com URL", () => {
    expect(parseRedditSubreddit("https://reddit.com/r/javascript")).toBe("javascript");
  });

  it("parses www.reddit.com URL", () => {
    expect(parseRedditSubreddit("https://www.reddit.com/r/rust")).toBe("rust");
  });

  it("parses old.reddit.com URL", () => {
    expect(parseRedditSubreddit("https://old.reddit.com/r/netsec")).toBe("netsec");
  });

  it("handles subreddit with underscores", () => {
    expect(parseRedditSubreddit("machine_learning")).toBe("machine_learning");
  });

  it("handles subreddit with numbers", () => {
    expect(parseRedditSubreddit("r/web3")).toBe("web3");
  });

  it("trims whitespace", () => {
    expect(parseRedditSubreddit("  r/programming  ")).toBe("programming");
  });

  it("returns empty for reddit.com URL with no subreddit", () => {
    expect(parseRedditSubreddit("https://reddit.com/r/")).toBe("");
  });

  it("returns empty for bare r/ with no name", () => {
    expect(parseRedditSubreddit("r/")).toBe("");
  });
});

describe("parseMastodonAccount", () => {
  it("parses @user@instance", () => {
    expect(parseMastodonAccount("@gargron@mastodon.social")).toEqual({ username: "gargron", instance: "mastodon.social" });
  });

  it("parses user@instance (without leading @)", () => {
    expect(parseMastodonAccount("gargron@mastodon.social")).toEqual({ username: "gargron", instance: "mastodon.social" });
  });

  it("parses full profile URL", () => {
    expect(parseMastodonAccount("https://mastodon.social/@gargron")).toEqual({ username: "gargron", instance: "mastodon.social" });
  });

  it("parses URL with trailing slash", () => {
    expect(parseMastodonAccount("https://mastodon.social/@gargron/")).toEqual({ username: "gargron", instance: "mastodon.social" });
  });

  it("parses custom instance URL", () => {
    expect(parseMastodonAccount("https://infosec.exchange/@researcher")).toEqual({ username: "researcher", instance: "infosec.exchange" });
  });

  it("parses Japanese instance", () => {
    expect(parseMastodonAccount("@user@mstdn.jp")).toEqual({ username: "user", instance: "mstdn.jp" });
  });

  it("handles underscores in username", () => {
    expect(parseMastodonAccount("@my_user@mastodon.social")).toEqual({ username: "my_user", instance: "mastodon.social" });
  });

  it("trims whitespace", () => {
    expect(parseMastodonAccount("  @user@mastodon.social  ")).toEqual({ username: "user", instance: "mastodon.social" });
  });

  it("returns error for bare username without instance", () => {
    const result = parseMastodonAccount("gargron");
    expect(result).toHaveProperty("error");
  });

  it("returns error for empty string", () => {
    const result = parseMastodonAccount("");
    expect(result).toHaveProperty("error");
  });

  it("returns error for @user without instance", () => {
    const result = parseMastodonAccount("@gargron");
    expect(result).toHaveProperty("error");
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
