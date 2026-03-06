import { inferPlatform } from "@/lib/sources/storage";
import type { SavedSource } from "@/lib/types/sources";

function makeSource(overrides: Partial<SavedSource> = {}): SavedSource {
  return {
    id: "test",
    type: "rss",
    label: "Test",
    feedUrl: "https://example.com/feed.xml",
    enabled: true,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("inferPlatform", () => {
  it("returns 'farcaster' for farcaster type sources", () => {
    expect(inferPlatform(makeSource({ type: "farcaster" }))).toBe("farcaster");
  });

  it("returns undefined for nostr type", () => {
    expect(inferPlatform(makeSource({ type: "nostr" }))).toBeUndefined();
  });

  it("detects YouTube from feedUrl", () => {
    expect(inferPlatform(makeSource({ feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC123" }))).toBe("youtube");
    expect(inferPlatform(makeSource({ feedUrl: "https://youtu.be/watch?v=abc" }))).toBe("youtube");
  });

  it("detects Bluesky from feedUrl", () => {
    expect(inferPlatform(makeSource({ feedUrl: "https://bsky.app/profile/user.bsky.social/rss" }))).toBe("bluesky");
  });

  it("detects Reddit from feedUrl", () => {
    expect(inferPlatform(makeSource({ feedUrl: "https://www.reddit.com/r/programming/.rss" }))).toBe("reddit");
  });

  it("detects GitHub from .atom feed", () => {
    expect(inferPlatform(makeSource({ feedUrl: "https://github.com/user/repo/releases.atom" }))).toBe("github");
  });

  it("does not detect GitHub without .atom extension", () => {
    expect(inferPlatform(makeSource({ feedUrl: "https://github.com/user/repo" }))).toBeUndefined();
  });

  it("detects topic from Google News URL", () => {
    expect(inferPlatform(makeSource({ feedUrl: "https://news.google.com/rss/topics/CAAqBwgKMOfGngswi-ixAw" }))).toBe("topic");
  });

  it("detects topic from label prefix 'Topic:'", () => {
    expect(inferPlatform(makeSource({ label: "Topic: AI & ML", feedUrl: "https://example.com/feed" }))).toBe("topic");
  });

  it("detects Farcaster from feeds.fcstr.xyz URL", () => {
    expect(inferPlatform(makeSource({ feedUrl: "https://feeds.fcstr.xyz/feed/vitalik.eth" }))).toBe("farcaster");
  });

  it("detects Mastodon from @user@instance label pattern", () => {
    expect(inferPlatform(makeSource({ label: "@user@mastodon.social", feedUrl: "https://mastodon.social/@user.rss" }))).toBe("mastodon");
  });

  it("detects Mastodon from /@user.rss URL pattern", () => {
    expect(inferPlatform(makeSource({ label: "Some Label", feedUrl: "https://mastodon.social/@username.rss" }))).toBe("mastodon");
  });

  it("does not detect Mastodon from single @ in label", () => {
    expect(inferPlatform(makeSource({ label: "@user", feedUrl: "https://example.com/feed" }))).toBeUndefined();
  });

  it("returns undefined for generic RSS feed", () => {
    expect(inferPlatform(makeSource({ feedUrl: "https://blog.example.com/rss.xml" }))).toBeUndefined();
  });

  it("returns undefined when feedUrl is empty string", () => {
    expect(inferPlatform(makeSource({ feedUrl: "" }))).toBeUndefined();
  });

  it("returns undefined when feedUrl is undefined", () => {
    expect(inferPlatform(makeSource({ feedUrl: undefined }))).toBeUndefined();
  });

  it("prioritizes URL-based detection (YouTube URL with Topic label)", () => {
    const source = makeSource({
      feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC123",
      label: "Topic: Something",
    });
    // YouTube check comes first in the code
    expect(inferPlatform(source)).toBe("youtube");
  });
});
