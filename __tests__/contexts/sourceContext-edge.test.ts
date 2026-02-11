/**
 * @jest-environment jsdom
 */
import { loadSources, saveSources } from "@/lib/sources/storage";
import type { SavedSource } from "@/lib/types/sources";

describe("sources storage — edge cases", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("handles source with minimal fields", () => {
    const minimal: SavedSource = {
      id: "min-1",
      type: "rss",
      label: "Minimal",
      enabled: true,
      createdAt: Date.now(),
    };
    saveSources("test", [minimal]);
    const loaded = loadSources("test");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].feedUrl).toBeUndefined();
    expect(loaded[0].relays).toBeUndefined();
    expect(loaded[0].pubkeys).toBeUndefined();
  });

  it("handles source with special characters in label", () => {
    const source: SavedSource = {
      id: "special-1",
      type: "rss",
      label: 'Feed with "quotes" & <tags> and 日本語',
      enabled: true,
      feedUrl: "https://example.com/feed.xml",
      createdAt: Date.now(),
    };
    saveSources("test", [source]);
    const loaded = loadSources("test");
    expect(loaded[0].label).toBe('Feed with "quotes" & <tags> and 日本語');
  });

  it("handles source with very long feedUrl", () => {
    const source: SavedSource = {
      id: "long-1",
      type: "rss",
      label: "Long URL Feed",
      enabled: true,
      feedUrl: "https://example.com/" + "path/".repeat(500) + "feed.xml",
      createdAt: Date.now(),
    };
    saveSources("test", [source]);
    const loaded = loadSources("test");
    expect(loaded[0].feedUrl).toBe(source.feedUrl);
  });

  it("handles nostr source with empty arrays", () => {
    const source: SavedSource = {
      id: "nostr-empty",
      type: "nostr",
      label: "Empty Nostr",
      enabled: false,
      relays: [],
      pubkeys: [],
      createdAt: Date.now(),
    };
    saveSources("test", [source]);
    const loaded = loadSources("test");
    expect(loaded[0].relays).toEqual([]);
    expect(loaded[0].pubkeys).toEqual([]);
  });

  it("preserves enabled=false state", () => {
    const source: SavedSource = {
      id: "disabled-1",
      type: "rss",
      label: "Disabled Feed",
      enabled: false,
      feedUrl: "https://disabled.example.com/feed",
      createdAt: Date.now(),
    };
    saveSources("test", [source]);
    const loaded = loadSources("test");
    expect(loaded[0].enabled).toBe(false);
  });

  it("handles principal IDs with special characters", () => {
    const principal = "rwlgt-iiaaa-aaaaa-aaaaa-cai";
    saveSources(principal, [{ id: "1", type: "rss", label: "Test", enabled: true, createdAt: Date.now() }]);
    const loaded = loadSources(principal);
    expect(loaded).toHaveLength(1);
  });

  it("different principals have isolated storage", () => {
    saveSources("principal-a", [{ id: "1", type: "rss", label: "A", enabled: true, createdAt: Date.now() }]);
    saveSources("principal-b", [{ id: "2", type: "rss", label: "B", enabled: true, createdAt: Date.now() }]);

    expect(loadSources("principal-a")[0].label).toBe("A");
    expect(loadSources("principal-b")[0].label).toBe("B");
    expect(loadSources("principal-c")).toEqual([]);
  });
});
