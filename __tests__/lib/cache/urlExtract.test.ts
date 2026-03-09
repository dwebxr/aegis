import {
  type ExtractionResult,
  getUrlCached,
  setUrlCache,
  _resetUrlCache,
} from "@/lib/cache/urlExtract";

beforeEach(() => {
  _resetUrlCache();
});

describe("urlExtract cache", () => {
  const successResult: ExtractionResult = {
    data: { title: "Test", content: "Hello world", source: "example.com" },
    status: 200,
  };

  const errorResult: ExtractionResult = {
    error: "Could not reach URL",
    status: 502,
  };

  describe("getUrlCached", () => {
    it("returns undefined for uncached URL", () => {
      expect(getUrlCached("https://example.com")).toBeUndefined();
    });

    it("returns cached success result", () => {
      setUrlCache("https://example.com", successResult);
      const cached = getUrlCached("https://example.com");
      expect(cached).toEqual(successResult);
      expect(cached!.data!.title).toBe("Test");
    });

    it("returns cached error result", () => {
      setUrlCache("https://fail.com", errorResult);
      const cached = getUrlCached("https://fail.com");
      expect(cached).toEqual(errorResult);
      expect(cached!.error).toBe("Could not reach URL");
    });

    it("differentiates by URL", () => {
      setUrlCache("https://a.com", successResult);
      setUrlCache("https://b.com", errorResult);
      expect(getUrlCached("https://a.com")!.status).toBe(200);
      expect(getUrlCached("https://b.com")!.status).toBe(502);
    });
  });

  describe("TTL expiration", () => {
    it("returns undefined after 30-minute TTL", () => {
      setUrlCache("https://example.com", successResult);
      expect(getUrlCached("https://example.com")).toBeDefined();

      const original = Date.now;
      Date.now = () => original() + 30 * 60 * 1000 + 1;
      expect(getUrlCached("https://example.com")).toBeUndefined();
      Date.now = original;
    });

    it("returns value just before TTL expires", () => {
      const baseTime = Date.now();
      const original = Date.now;
      Date.now = () => baseTime;

      setUrlCache("https://example.com", successResult);

      Date.now = () => baseTime + 30 * 60 * 1000 - 1;
      expect(getUrlCached("https://example.com")).toBeDefined();

      Date.now = original;
    });
  });

  describe("FIFO eviction", () => {
    it("evicts oldest entry when cache exceeds 200", () => {
      for (let i = 0; i < 200; i++) {
        setUrlCache(`https://example.com/${i}`, { ...successResult });
      }
      expect(getUrlCached("https://example.com/0")).toBeDefined();

      setUrlCache("https://example.com/200", successResult);
      expect(getUrlCached("https://example.com/0")).toBeUndefined();
      expect(getUrlCached("https://example.com/1")).toBeDefined();
      expect(getUrlCached("https://example.com/200")).toBeDefined();
    });
  });

  describe("_resetUrlCache", () => {
    it("clears all entries", () => {
      setUrlCache("https://a.com", successResult);
      setUrlCache("https://b.com", errorResult);
      _resetUrlCache();
      expect(getUrlCached("https://a.com")).toBeUndefined();
      expect(getUrlCached("https://b.com")).toBeUndefined();
    });
  });
});
