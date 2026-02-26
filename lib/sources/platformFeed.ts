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

  // Reddit: /r/subreddit → native RSS feed
  if (host === "reddit.com" || host === "old.reddit.com") {
    const subMatch = parsed.pathname.match(/^\/r\/([A-Za-z0-9_]+)\/?$/);
    if (subMatch) {
      const sub = subMatch[1];
      return { feeds: [{ url: `https://www.reddit.com/r/${sub}/.rss`, title: `r/${sub}`, type: "rss" }] };
    }
  }

  // Bluesky: /profile/handle → native RSS feed
  if (host === "bsky.app") {
    const handleMatch = parsed.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if (handleMatch) {
      return { feeds: [{ url: `https://bsky.app/profile/${handleMatch[1]}/rss`, title: `Bluesky: @${handleMatch[1]}`, type: "rss" }] };
    }
  }

  // Mastodon: /@username on any instance → native RSS feed
  {
    const userMatch = parsed.pathname.match(/^\/@([A-Za-z0-9_]+)\/?$/);
    if (userMatch) {
      const user = userMatch[1];
      return { feeds: [{ url: `${parsed.origin}/@${user}.rss`, title: `@${user}@${host}`, type: "rss" }] };
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

/** Normalize subreddit from URL, r/name, /r/name, or bare name. */
export function parseRedditSubreddit(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes("reddit.com/r/")) {
    const match = trimmed.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/);
    return match ? match[1] : "";
  }
  return trimmed.replace(/^\/?(r\/)?/, "");
}

/** Parse Mastodon account from URL or @user@instance notation.
 *  Returns `{ username, instance }` or `{ error }`. */
export function parseMastodonAccount(input: string): { username: string; instance: string } | { error: string } {
  const trimmed = input.trim();

  // Full URL: https://mastodon.social/@user
  const urlMatch = trimmed.match(/^https?:\/\/([^/]+)\/@([A-Za-z0-9_]+)\/?$/);
  if (urlMatch) return { instance: urlMatch[1], username: urlMatch[2] };

  // @user@instance or user@instance
  const atMatch = trimmed.replace(/^@/, "").match(/^([A-Za-z0-9_]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/);
  if (atMatch) return { username: atMatch[1], instance: atMatch[2] };

  return { error: "Enter as @user@instance (e.g. @user@mastodon.social) or a profile URL" };
}

/** Parse Farcaster user from Warpcast URL, @username, or bare username.
 *  Returns `{ username }` or `{ error }`. */
export function parseFarcasterUser(input: string): { username: string } | { error: string } {
  const trimmed = input.trim();

  // Warpcast URL: https://warpcast.com/username
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?warpcast\.com\/([A-Za-z0-9._-]+)\/?$/);
  if (urlMatch) return { username: urlMatch[1] };

  // @username or bare username (Farcaster allows letters, numbers, hyphens, dots)
  const handle = trimmed.replace(/^@/, "");
  if (/^[A-Za-z0-9._-]{1,20}$/.test(handle)) return { username: handle };

  return { error: "Enter as @username or a Warpcast URL (e.g. @vitalik)" };
}

export function buildTopicFeedUrl(keywords: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(keywords)}&hl=en`;
}
