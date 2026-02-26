export interface PlatformFeedResult {
  feeds: Array<{ url: string; title: string; type: string }>;
}

/** Instant URL pattern match for known platforms. Returns null → fall through to HTML fetch. */
export function detectPlatformFeed(parsed: URL): PlatformFeedResult | null {
  const host = parsed.hostname.replace("www.", "");

  // YouTube: /channel/UCxxx → direct RSS (no HTML fetch needed)
  if (host === "youtube.com" || host === "m.youtube.com") {
    const channelMatch = parsed.pathname.match(/^\/channel\/(UC[\w-]+)/);
    if (channelMatch) {
      return { feeds: [{ url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`, title: "YouTube Channel", type: "atom" }] };
    }
    // @handle and /c/name require HTML fetch to resolve channel ID
    return null;
  }

  // GitHub: /owner/repo → releases.atom
  if (host === "github.com") {
    const repoMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?(?:releases\/?)?$/);
    if (repoMatch && !["settings", "issues", "pulls", "actions", "wiki", "discussions"].includes(repoMatch[2])) {
      const owner = repoMatch[1], repo = repoMatch[2].replace(/\.git$/, "");
      return { feeds: [{ url: `https://github.com/${owner}/${repo}/releases.atom`, title: `${owner}/${repo} Releases`, type: "atom" }] };
    }
  }

  // X (Twitter): /handle → RSSHub RSS feed (no API key required)
  if (host === "twitter.com" || host === "x.com") {
    const handleMatch = parsed.pathname.match(/^\/([^/?\s]+)\/?$/);
    if (handleMatch && !["home", "explore", "notifications", "messages", "search", "settings", "i", "compose"].includes(handleMatch[1])) {
      const handle = handleMatch[1];
      return { feeds: [{ url: `https://rsshub.app/twitter/user/${handle}`, title: `X: @${handle}`, type: "rss" }] };
    }
  }

  // Bluesky: /profile/handle → native RSS feed
  if (host === "bsky.app") {
    const handleMatch = parsed.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if (handleMatch) {
      return { feeds: [{ url: `https://bsky.app/profile/${handleMatch[1]}/rss`, title: `Bluesky: @${handleMatch[1]}`, type: "rss" }] };
    }
  }

  return null;
}

/** Extract YouTube channel ID from HTML (@handle / /c/ pages). 3-regex fallback chain. */
export function extractYouTubeChannelId(html: string): string | null {
  const match = html.match(/"(?:externalId|channelId)"\s*:\s*"(UC[\w-]+)"/)
    || html.match(/itemprop="channelId"[^>]*content="(UC[\w-]+)"/)
    || html.match(/<link[^>]+rel="canonical"[^>]+href="https?:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/);
  return match ? match[1] : null;
}

/** Parse owner/repo from URL or shorthand. Returns `{ error }` on invalid input. */
export function parseGitHubRepo(input: string): { owner: string; repo: string } | { error: string } {
  if (input.includes("github.com")) {
    const match = input.match(/github\.com\/([^/]+)\/([^/\s]+)/);
    if (!match) return { error: "Invalid GitHub URL" };
    const owner = match[1];
    const repo = match[2].replace(/\.git$/, "").replace(/\/$/, "");
    return { owner, repo };
  }
  const parts = input.split("/").filter(Boolean);
  if (parts.length !== 2) return { error: "Enter as owner/repo (e.g. vercel/next.js)" };
  return { owner: parts[0], repo: parts[1] };
}

/** Normalize Bluesky handle from URL, @handle, or bare name → `handle.bsky.social`. */
export function parseBlueskyHandle(input: string): string {
  let handle = input;
  if (handle.includes("bsky.app/profile/")) {
    const match = handle.match(/bsky\.app\/profile\/([^/\s]+)/);
    if (match) handle = match[1];
  }
  handle = handle.replace(/^@/, "");
  if (!handle.includes(".") && !handle.startsWith("did:")) handle += ".bsky.social";
  return handle;
}

/** Normalize X (Twitter) handle from URL, @handle, or bare username. */
export function parseTwitterHandle(input: string): string {
  let handle = input;
  if (handle.includes("twitter.com/") || handle.includes("x.com/")) {
    const match = handle.match(/(?:twitter\.com|x\.com)\/([^/?\s]+)/);
    if (match) handle = match[1];
  }
  return handle.trim().replace(/^@/, "");
}

export function buildTopicFeedUrl(keywords: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(keywords)}&hl=en`;
}
