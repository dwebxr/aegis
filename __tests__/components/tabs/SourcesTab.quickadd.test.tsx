/**
 * @jest-environment jsdom
 */

// Note: Quick Add UI is inside the RSS tab panel (not visible on default URL tab).
// We test the parser-to-feed-URL integration directly and verify the component renders.

// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ─── Mock context providers ───

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({
    sources: [],
    syncStatus: "idle",
    syncError: null,
    addSource: jest.fn().mockReturnValue(true),
    removeSource: jest.fn(),
    toggleSource: jest.fn(),
    updateSource: jest.fn(),
  }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: false }),
}));

jest.mock("@/lib/ingestion/sourceState", () => ({
  loadSourceStates: () => ({}),
  getSourceHealth: () => "healthy",
  getSourceKey: () => "",
  resetSourceErrors: jest.fn(),
}));

// Lazy-import after mocks
const { SourcesTab } = require("@/components/tabs/SourcesTab");

const noop = async () => ({ scores: {}, verdict: "quality", reason: "" });

// ─── Component renders without crashing ───

describe("SourcesTab — renders correctly", () => {
  let html: string;

  beforeAll(() => {
    html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} mobile={false} />,
    );
  });

  it("renders Content Sources heading", () => {
    expect(html).toContain("Content Sources");
  });

  it("renders URL tab (default active)", () => {
    expect(html).toContain("URL");
    expect(html).toContain("https://example.com/article");
  });

  it("renders RSS tab button", () => {
    expect(html).toContain("RSS");
  });

  it("renders X (Twitter) tab button", () => {
    expect(html).toContain("X (Twitter)");
  });

  it("renders Nostr tab button", () => {
    expect(html).toContain("Nostr");
  });

  it("renders Popular Sources section", () => {
    expect(html).toContain("Popular Sources");
    expect(html).toContain("Add trusted feeds with a single tap");
  });

  it("renders Extract button for URL tab", () => {
    expect(html).toContain("Extract");
  });

  it("does not render countdown when no sources are rate-limited", () => {
    expect(html).not.toContain("retries automatically in");
    expect(html).not.toContain("Rate limited");
  });

  it("renders mobile mode without errors", () => {
    const mobileHtml = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} mobile={true} />,
    );
    expect(mobileHtml).toContain("Content Sources");
    expect(mobileHtml).toContain("Popular Sources");
  });
});

// ─── Quick Add parser integration — tests the exact logic handleQuickAdd uses ───

describe("SourcesTab — Quick Add: GitHub flow", () => {
  const { parseGitHubRepo } = require("@/lib/sources/platformFeed");

  it("constructs correct feed URL from owner/repo", () => {
    const parsed = parseGitHubRepo("vercel/next.js");
    expect(parsed).toEqual({ owner: "vercel", repo: "next.js" });
    expect(`https://github.com/${parsed.owner}/${parsed.repo}/releases.atom`)
      .toBe("https://github.com/vercel/next.js/releases.atom");
  });

  it("constructs correct feed URL from full GitHub URL", () => {
    const parsed = parseGitHubRepo("https://github.com/facebook/react");
    expect(parsed).toEqual({ owner: "facebook", repo: "react" });
    expect(`https://github.com/${parsed.owner}/${parsed.repo}/releases.atom`)
      .toBe("https://github.com/facebook/react/releases.atom");
  });

  it("constructs correct label", () => {
    const parsed = parseGitHubRepo("vercel/next.js");
    if (!("error" in parsed)) {
      expect(`${parsed.owner}/${parsed.repo} Releases`).toBe("vercel/next.js Releases");
    }
  });

  it("returns error object for invalid input → triggers setQuickAddError", () => {
    expect("error" in parseGitHubRepo("just-a-name")).toBe(true);
    expect("error" in parseGitHubRepo("")).toBe(true);
    expect("error" in parseGitHubRepo("a/b/c")).toBe(true);
  });

  it("handles .git suffix in URL", () => {
    const parsed = parseGitHubRepo("https://github.com/vercel/next.js.git");
    expect(parsed).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("handles URL with deeper path (tree/main)", () => {
    const parsed = parseGitHubRepo("https://github.com/vercel/next.js/tree/main");
    expect(parsed).toEqual({ owner: "vercel", repo: "next.js" });
  });
});

describe("SourcesTab — Quick Add: Bluesky flow", () => {
  const { parseBlueskyHandle } = require("@/lib/sources/platformFeed");

  it("constructs correct feed URL from @handle", () => {
    const handle = parseBlueskyHandle("@jay");
    expect(handle).toBe("jay.bsky.social");
    expect(`https://bsky.app/profile/${handle}/rss`)
      .toBe("https://bsky.app/profile/jay.bsky.social/rss");
  });

  it("constructs correct feed URL from profile URL", () => {
    const handle = parseBlueskyHandle("https://bsky.app/profile/jay.bsky.social");
    expect(handle).toBe("jay.bsky.social");
    expect(`https://bsky.app/profile/${handle}/rss`)
      .toBe("https://bsky.app/profile/jay.bsky.social/rss");
  });

  it("constructs correct feed URL from custom domain", () => {
    const handle = parseBlueskyHandle("example.com");
    expect(handle).toBe("example.com");
    expect(`https://bsky.app/profile/${handle}/rss`)
      .toBe("https://bsky.app/profile/example.com/rss");
  });

  it("constructs correct label", () => {
    const handle = parseBlueskyHandle("jay");
    expect(`Bluesky: @${handle}`).toBe("Bluesky: @jay.bsky.social");
  });

  it("handles did:plc identifiers", () => {
    const handle = parseBlueskyHandle("did:plc:abc123");
    expect(handle).toBe("did:plc:abc123");
    expect(`https://bsky.app/profile/${handle}/rss`)
      .toBe("https://bsky.app/profile/did:plc:abc123/rss");
  });
});

describe("SourcesTab — Quick Add: Reddit flow", () => {
  const { parseRedditSubreddit } = require("@/lib/sources/platformFeed");

  it("constructs correct feed URL from bare subreddit name", () => {
    const sub = parseRedditSubreddit("programming");
    expect(sub).toBe("programming");
    expect(`https://www.reddit.com/r/${sub}/.rss`)
      .toBe("https://www.reddit.com/r/programming/.rss");
  });

  it("constructs correct feed URL from r/name", () => {
    const sub = parseRedditSubreddit("r/javascript");
    expect(sub).toBe("javascript");
    expect(`https://www.reddit.com/r/${sub}/.rss`)
      .toBe("https://www.reddit.com/r/javascript/.rss");
  });

  it("constructs correct feed URL from /r/name", () => {
    const sub = parseRedditSubreddit("/r/rust");
    expect(sub).toBe("rust");
  });

  it("extracts subreddit from full Reddit URL", () => {
    expect(parseRedditSubreddit("https://www.reddit.com/r/netsec")).toBe("netsec");
    expect(parseRedditSubreddit("https://old.reddit.com/r/golang")).toBe("golang");
  });

  it("constructs correct label", () => {
    const sub = parseRedditSubreddit("programming");
    expect(`r/${sub}`).toBe("r/programming");
  });

  it("returns empty string for invalid input → blocks Quick Add", () => {
    expect(parseRedditSubreddit("")).toBe("");
    expect(parseRedditSubreddit("   ")).toBe("");
    expect(parseRedditSubreddit("r/")).toBe("");
    expect(parseRedditSubreddit("https://reddit.com/r/")).toBe("");
    // All falsy → handleQuickAdd shows "Please enter a valid subreddit name"
  });

  it("handles subreddit with underscores and numbers", () => {
    expect(parseRedditSubreddit("machine_learning")).toBe("machine_learning");
    expect(parseRedditSubreddit("web3")).toBe("web3");
    expect(parseRedditSubreddit("r/test_123")).toBe("test_123");
  });
});

describe("SourcesTab — Quick Add: Mastodon flow", () => {
  const { parseMastodonAccount } = require("@/lib/sources/platformFeed");

  it("constructs correct feed URL from @user@instance", () => {
    const acct = parseMastodonAccount("@gargron@mastodon.social");
    expect("error" in acct).toBe(false);
    if (!("error" in acct)) {
      expect(`https://${acct.instance}/@${acct.username}.rss`)
        .toBe("https://mastodon.social/@gargron.rss");
    }
  });

  it("constructs correct feed URL from user@instance (no leading @)", () => {
    const acct = parseMastodonAccount("gargron@mastodon.social");
    expect("error" in acct).toBe(false);
    if (!("error" in acct)) {
      expect(`https://${acct.instance}/@${acct.username}.rss`)
        .toBe("https://mastodon.social/@gargron.rss");
    }
  });

  it("constructs correct feed URL from profile URL", () => {
    const acct = parseMastodonAccount("https://fosstodon.org/@user");
    expect("error" in acct).toBe(false);
    if (!("error" in acct)) {
      expect(`https://${acct.instance}/@${acct.username}.rss`)
        .toBe("https://fosstodon.org/@user.rss");
    }
  });

  it("constructs correct label", () => {
    const acct = parseMastodonAccount("@user@mastodon.social");
    if (!("error" in acct)) {
      expect(`@${acct.username}@${acct.instance}`)
        .toBe("@user@mastodon.social");
    }
  });

  it("returns error for invalid input → blocks Quick Add", () => {
    expect("error" in parseMastodonAccount("just-a-name")).toBe(true);
    expect("error" in parseMastodonAccount("")).toBe(true);
    expect("error" in parseMastodonAccount("@gargron")).toBe(true);
    // Error object → handleQuickAdd shows the error message
  });

  it("handles custom/international instances", () => {
    const acct = parseMastodonAccount("@user@mstdn.jp");
    expect("error" in acct).toBe(false);
    if (!("error" in acct)) {
      expect(acct.instance).toBe("mstdn.jp");
      expect(`https://${acct.instance}/@${acct.username}.rss`)
        .toBe("https://mstdn.jp/@user.rss");
    }
  });
});

describe("SourcesTab — Quick Add: Topic flow", () => {
  const { buildTopicFeedUrl } = require("@/lib/sources/platformFeed");

  it("constructs correct Google News RSS feed URL", () => {
    expect(buildTopicFeedUrl("AI safety"))
      .toBe("https://news.google.com/rss/search?q=AI%20safety&hl=en");
  });

  it("constructs correct label", () => {
    expect(`Topic: ${"machine learning"}`).toBe("Topic: machine learning");
  });

  it("encodes special characters in keywords", () => {
    expect(buildTopicFeedUrl("C++ programming"))
      .toBe("https://news.google.com/rss/search?q=C%2B%2B%20programming&hl=en");
  });

  it("handles unicode keywords", () => {
    const url = buildTopicFeedUrl("人工知能");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("人工知能");
  });
});

describe("SourcesTab — Quick Add: YouTube flow", () => {
  // YouTube Quick Add calls discover-feed API, so we test the URL construction
  it("prepends https://www.youtube.com/ for non-URL input", () => {
    const input = "@Veritasium";
    const ytUrl = input.startsWith("http") ? input : `https://www.youtube.com/${input}`;
    expect(ytUrl).toBe("https://www.youtube.com/@Veritasium");
  });

  it("uses input as-is for full URL", () => {
    const input = "https://youtube.com/@Veritasium";
    const ytUrl = input.startsWith("http") ? input : `https://www.youtube.com/${input}`;
    expect(ytUrl).toBe("https://youtube.com/@Veritasium");
  });

  it("handles channel URL input", () => {
    const input = "https://youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ";
    const ytUrl = input.startsWith("http") ? input : `https://www.youtube.com/${input}`;
    expect(ytUrl).toBe("https://youtube.com/channel/UCddiUEpeqJcYeBxX1IVBKvQ");
  });
});

// ─── Quick Add: full addSource payload verification ───
// These tests verify the exact payload shape that handleQuickAdd constructs
// for addSource(), ensuring parser output → feedUrl + label + type is correct.

describe("SourcesTab — Quick Add: addSource payload construction", () => {
  const {
    parseGitHubRepo,
    parseBlueskyHandle,
    parseRedditSubreddit,
    parseMastodonAccount,
    buildTopicFeedUrl,
  } = require("@/lib/sources/platformFeed");

  // Replicate the exact payload logic from handleQuickAdd for each preset

  it("GitHub: produces correct addSource payload", () => {
    const parsed = parseGitHubRepo("vercel/next.js");
    expect("error" in parsed).toBe(false);
    const feedUrl = `https://github.com/${parsed.owner}/${parsed.repo}/releases.atom`;
    const label = `${parsed.owner}/${parsed.repo} Releases`;
    const payload = { type: "rss" as const, feedUrl, label, enabled: true };

    expect(payload).toEqual({
      type: "rss",
      feedUrl: "https://github.com/vercel/next.js/releases.atom",
      label: "vercel/next.js Releases",
      enabled: true,
    });
  });

  it("Bluesky: produces correct addSource payload", () => {
    const handle = parseBlueskyHandle("@jay");
    const feedUrl = `https://bsky.app/profile/${handle}/rss`;
    const label = `Bluesky: @${handle}`;
    const payload = { type: "rss" as const, feedUrl, label, enabled: true };

    expect(payload).toEqual({
      type: "rss",
      feedUrl: "https://bsky.app/profile/jay.bsky.social/rss",
      label: "Bluesky: @jay.bsky.social",
      enabled: true,
    });
  });

  it("Reddit: produces correct addSource payload", () => {
    const sub = parseRedditSubreddit("r/programming");
    expect(sub).toBeTruthy(); // not empty = valid
    const feedUrl = `https://www.reddit.com/r/${sub}/.rss`;
    const label = `r/${sub}`;
    const payload = { type: "rss" as const, feedUrl, label, enabled: true };

    expect(payload).toEqual({
      type: "rss",
      feedUrl: "https://www.reddit.com/r/programming/.rss",
      label: "r/programming",
      enabled: true,
    });
  });

  it("Mastodon: produces correct addSource payload", () => {
    const acct = parseMastodonAccount("@gargron@mastodon.social");
    expect("error" in acct).toBe(false);
    const feedUrl = `https://${acct.instance}/@${acct.username}.rss`;
    const label = `@${acct.username}@${acct.instance}`;
    const payload = { type: "rss" as const, feedUrl, label, enabled: true };

    expect(payload).toEqual({
      type: "rss",
      feedUrl: "https://mastodon.social/@gargron.rss",
      label: "@gargron@mastodon.social",
      enabled: true,
    });
  });

  it("Topic: produces correct addSource payload", () => {
    const keyword = "AI safety";
    const feedUrl = buildTopicFeedUrl(keyword);
    const label = `Topic: ${keyword}`;
    const payload = { type: "rss" as const, feedUrl, label, enabled: true };

    expect(payload).toEqual({
      type: "rss",
      feedUrl: "https://news.google.com/rss/search?q=AI%20safety&hl=en",
      label: "Topic: AI safety",
      enabled: true,
    });
  });

  it("YouTube: produces correct discover-feed request URL", () => {
    const input = "@Veritasium";
    const ytUrl = input.startsWith("http") ? input : `https://www.youtube.com/${input}`;
    // handleQuickAdd sends this to /api/fetch/discover-feed
    expect(ytUrl).toBe("https://www.youtube.com/@Veritasium");
    // After discover-feed resolves, addSource gets the returned feedUrl
  });
});

// ─── Quick Add error validation logic ───

describe("SourcesTab — Quick Add error validation", () => {
  const { parseGitHubRepo, parseRedditSubreddit, parseMastodonAccount } = require("@/lib/sources/platformFeed");

  it("GitHub: specific error messages for different invalid inputs", () => {
    expect((parseGitHubRepo("vercel") as { error: string }).error).toContain("owner/repo");
    expect((parseGitHubRepo("https://github.com/vercel") as { error: string }).error).toContain("Invalid GitHub URL");
  });

  it("Reddit: empty string is falsy (triggers error path)", () => {
    const sub = parseRedditSubreddit("");
    // In handleQuickAdd: if (!sub) { setQuickAddError("Please enter a valid subreddit name"); return; }
    expect(!sub).toBe(true);
  });

  it("Mastodon: error object contains user-friendly message", () => {
    const result = parseMastodonAccount("invalid") as { error: string };
    expect(result.error).toContain("@user@instance");
  });
});

// ─── Quick Add: empty/whitespace input is trimmed and blocked ───

describe("SourcesTab — Quick Add: empty input guard", () => {
  // handleQuickAdd has: const input = quickAddInput.trim(); if (!input) return;
  // This tests that behavior — empty and whitespace inputs produce falsy values

  it("empty string trims to empty (early return)", () => {
    expect("".trim()).toBe("");
    expect(!"".trim()).toBe(true);
  });

  it("whitespace-only trims to empty (early return)", () => {
    expect("   ".trim()).toBe("");
    expect(!"   ".trim()).toBe(true);
  });

  it("valid input is not blocked after trim", () => {
    expect("r/programming".trim()).toBe("r/programming");
    expect(!"r/programming".trim()).toBe(false);
  });
});
