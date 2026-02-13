import { DEMO_SOURCES } from "@/lib/demo/sources";

describe("Demo mode integration", () => {
  describe("demo scheduler sources", () => {
    it("converts DEMO_SOURCES to scheduler format", () => {
      const schedulerSources = DEMO_SOURCES.map(s => ({
        type: s.type as "rss" | "url" | "nostr",
        config: { feedUrl: s.feedUrl! },
        enabled: true,
      }));

      expect(schedulerSources).toHaveLength(3);
      for (const src of schedulerSources) {
        expect(src.type).toBe("rss");
        expect(src.config.feedUrl).toBeDefined();
        expect(src.config.feedUrl).toMatch(/^https:\/\//);
        expect(src.enabled).toBe(true);
      }
    });

    it("all DEMO_SOURCES have required fields for RSS", () => {
      for (const source of DEMO_SOURCES) {
        expect(source.type).toBe("rss");
        expect(typeof source.feedUrl).toBe("string");
        expect(source.feedUrl!.length).toBeGreaterThan(0);
        expect(typeof source.label).toBe("string");
        expect(source.label.length).toBeGreaterThan(0);
      }
    });

    it("DEMO_SOURCES have unique IDs", () => {
      const ids = DEMO_SOURCES.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("DEMO_SOURCES have unique feed URLs", () => {
      const urls = DEMO_SOURCES.map(s => s.feedUrl);
      expect(new Set(urls).size).toBe(urls.length);
    });
  });
});
