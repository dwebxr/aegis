/**
 * @jest-environment jsdom
 */
import { loadSources, saveSources } from "@/lib/sources/storage";
import type { SavedSource } from "@/lib/types/sources";

function makeFakeSource(overrides: Partial<SavedSource> = {}): SavedSource {
  return {
    id: "src-1",
    type: "rss",
    label: "Test Feed",
    enabled: true,
    feedUrl: "https://example.com/feed.xml",
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe("sources/storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("loadSources", () => {
    it("returns empty array when no data stored", () => {
      expect(loadSources("principal-1")).toEqual([]);
    });

    it("loads previously saved sources", () => {
      const sources = [makeFakeSource(), makeFakeSource({ id: "src-2", label: "Second" })];
      saveSources("principal-1", sources);

      const loaded = loadSources("principal-1");
      expect(loaded).toHaveLength(2);
      expect(loaded[0].label).toBe("Test Feed");
      expect(loaded[1].label).toBe("Second");
    });

    it("returns empty array on corrupted JSON", () => {
      localStorage.setItem("aegis_sources_principal-1", "{{broken json");
      expect(loadSources("principal-1")).toEqual([]);
    });

    it("returns empty array when stored value is not an array", () => {
      localStorage.setItem("aegis_sources_principal-1", '{"not":"an array"}');
      expect(loadSources("principal-1")).toEqual([]);
    });

    it("returns empty array when stored value is a string", () => {
      localStorage.setItem("aegis_sources_principal-1", '"just a string"');
      expect(loadSources("principal-1")).toEqual([]);
    });

    it("returns empty array when stored value is null JSON", () => {
      localStorage.setItem("aegis_sources_principal-1", "null");
      expect(loadSources("principal-1")).toEqual([]);
    });

    it("filters out malformed items missing required fields", () => {
      localStorage.setItem("aegis_sources_principal-1", JSON.stringify([
        { id: "good", type: "rss", label: "Good", enabled: true, createdAt: 0 },
        { not: "a source" },
        null,
        { id: "no-type", enabled: true },
      ]));
      const loaded = loadSources("principal-1");
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("good");
    });

    it("isolates sources by principal ID", () => {
      saveSources("user-a", [makeFakeSource({ label: "A's feed" })]);
      saveSources("user-b", [makeFakeSource({ label: "B's feed" })]);

      expect(loadSources("user-a")[0].label).toBe("A's feed");
      expect(loadSources("user-b")[0].label).toBe("B's feed");
      expect(loadSources("user-c")).toEqual([]);
    });
  });

  describe("saveSources", () => {
    it("returns true on success", () => {
      expect(saveSources("p-1", [makeFakeSource()])).toBe(true);
    });

    it("persists data to localStorage", () => {
      saveSources("p-1", [makeFakeSource({ label: "Saved!" })]);
      const raw = localStorage.getItem("aegis_sources_p-1");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed[0].label).toBe("Saved!");
    });

    it("overwrites previous data entirely", () => {
      saveSources("p-1", [makeFakeSource({ id: "old" })]);
      saveSources("p-1", [makeFakeSource({ id: "new" })]);

      const loaded = loadSources("p-1");
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("new");
    });

    it("saves empty array", () => {
      saveSources("p-1", [makeFakeSource()]);
      saveSources("p-1", []);
      expect(loadSources("p-1")).toEqual([]);
    });

    it("handles localStorage error gracefully", () => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("QuotaExceeded"); };

      expect(saveSources("p-1", [makeFakeSource()])).toBe(false);

      Storage.prototype.setItem = originalSetItem;
    });
  });

  describe("roundtrip integrity", () => {
    it("preserves nostr source with relays and pubkeys", () => {
      const nostrSource = makeFakeSource({
        id: "nostr-1",
        type: "nostr",
        label: "My Nostr Feed",
        relays: ["wss://relay.damus.io", "wss://nos.lol"],
        pubkeys: ["npub1abc", "npub1def"],
        feedUrl: undefined,
      });

      saveSources("p-1", [nostrSource]);
      const loaded = loadSources("p-1");

      expect(loaded[0].type).toBe("nostr");
      expect(loaded[0].relays).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
      expect(loaded[0].pubkeys).toEqual(["npub1abc", "npub1def"]);
      expect(loaded[0].feedUrl).toBeUndefined();
    });

    it("preserves all fields including createdAt timestamp", () => {
      const source = makeFakeSource({ createdAt: 1234567890123 });
      saveSources("p-1", [source]);
      const loaded = loadSources("p-1");
      expect(loaded[0].createdAt).toBe(1234567890123);
    });

    it("preserves platform field through save/load cycle", () => {
      const sources = [
        makeFakeSource({ id: "yt-1", label: "YouTube Channel", platform: "youtube" }),
        makeFakeSource({ id: "bs-1", label: "Bluesky: @user", platform: "bluesky" }),
        makeFakeSource({ id: "plain-1", label: "Plain RSS" }),
      ];
      saveSources("p-1", sources);
      const loaded = loadSources("p-1");
      expect(loaded[0].platform).toBe("youtube");
      expect(loaded[1].platform).toBe("bluesky");
      expect(loaded[2].platform).toBeUndefined();
    });

    it("preserves farcaster source with platform, fid, and username", () => {
      const source = makeFakeSource({
        id: "fc-1",
        type: "farcaster",
        label: "Farcaster: @vitalik",
        platform: "farcaster",
        fid: 5650,
        username: "vitalik",
      });
      saveSources("p-1", [source]);
      const loaded = loadSources("p-1");
      expect(loaded[0].type).toBe("farcaster");
      expect(loaded[0].platform).toBe("farcaster");
      expect(loaded[0].fid).toBe(5650);
      expect(loaded[0].username).toBe("vitalik");
    });

    it("handles large number of sources", () => {
      const sources = Array.from({ length: 50 }, (_, i) =>
        makeFakeSource({ id: `src-${i}`, label: `Feed ${i}` })
      );
      saveSources("p-1", sources);
      const loaded = loadSources("p-1");
      expect(loaded).toHaveLength(50);
      expect(loaded[49].id).toBe("src-49");
    });
  });
});
