import { getOgCached, setOgCache, _resetOgCache } from "@/lib/cache/ogimage";

beforeEach(() => {
  _resetOgCache();
});

describe("ogimage cache", () => {
  describe("getOgCached", () => {
    it("returns undefined for uncached URL", () => {
      expect(getOgCached("https://example.com/page")).toBeUndefined();
    });

    it("returns cached imageUrl string", () => {
      setOgCache("https://example.com/page", "https://example.com/img.jpg");
      expect(getOgCached("https://example.com/page")).toBe("https://example.com/img.jpg");
    });

    it("returns cached null (checked, no image found)", () => {
      setOgCache("https://example.com/no-og", null);
      expect(getOgCached("https://example.com/no-og")).toBeNull();
    });

    it("distinguishes null (checked) from undefined (not cached)", () => {
      setOgCache("https://a.com", null);
      const checked = getOgCached("https://a.com");
      const notCached = getOgCached("https://b.com");
      expect(checked).toBeNull();
      expect(notCached).toBeUndefined();
    });
  });

  describe("TTL expiration", () => {
    it("returns undefined after TTL expires", () => {
      setOgCache("https://example.com/page", "https://example.com/img.jpg");
      expect(getOgCached("https://example.com/page")).toBe("https://example.com/img.jpg");

      // Advance time past 1-hour TTL
      const original = Date.now;
      Date.now = () => original() + 60 * 60 * 1000 + 1;
      expect(getOgCached("https://example.com/page")).toBeUndefined();
      Date.now = original;
    });

    it("returns value just before TTL expires", () => {
      const baseTime = Date.now();
      const original = Date.now;
      Date.now = () => baseTime;

      setOgCache("https://example.com/page", "https://example.com/img.jpg");

      // 1ms before expiration
      Date.now = () => baseTime + 60 * 60 * 1000 - 1;
      expect(getOgCached("https://example.com/page")).toBe("https://example.com/img.jpg");

      Date.now = original;
    });
  });

  describe("FIFO eviction", () => {
    it("evicts oldest entry when cache exceeds 500", () => {
      // Fill cache to max
      for (let i = 0; i < 500; i++) {
        setOgCache(`https://example.com/${i}`, `img-${i}`);
      }
      // All entries should be accessible
      expect(getOgCached("https://example.com/0")).toBe("img-0");
      expect(getOgCached("https://example.com/499")).toBe("img-499");

      // Adding one more should evict the first
      setOgCache("https://example.com/500", "img-500");
      expect(getOgCached("https://example.com/0")).toBeUndefined();
      expect(getOgCached("https://example.com/1")).toBe("img-1");
      expect(getOgCached("https://example.com/500")).toBe("img-500");
    });
  });

  describe("_resetOgCache", () => {
    it("clears all entries", () => {
      setOgCache("https://a.com", "img-a");
      setOgCache("https://b.com", null);
      _resetOgCache();
      expect(getOgCached("https://a.com")).toBeUndefined();
      expect(getOgCached("https://b.com")).toBeUndefined();
    });
  });
});
