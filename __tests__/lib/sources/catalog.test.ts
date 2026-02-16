import { POPULAR_SOURCES, CATALOG_CATEGORIES } from "@/lib/sources/catalog";

describe("catalog data integrity", () => {
  const categoryIds = new Set(CATALOG_CATEGORIES.map(c => c.id));

  it("every source has required fields", () => {
    for (const s of POPULAR_SOURCES) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.feedUrl).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.emoji).toBeTruthy();
      expect(s.color).toBeTruthy();
    }
  });

  it("ids are unique", () => {
    const ids = POPULAR_SOURCES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("feedUrls are unique", () => {
    const urls = POPULAR_SOURCES.map(s => s.feedUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("all feedUrls start with https://", () => {
    for (const s of POPULAR_SOURCES) {
      expect(s.feedUrl).toMatch(/^https:\/\//);
    }
  });

  it("every category referenced in sources is defined", () => {
    for (const s of POPULAR_SOURCES) {
      expect(categoryIds.has(s.category)).toBe(true);
    }
  });

  it("every defined category has at least one source", () => {
    for (const cat of CATALOG_CATEGORIES) {
      const count = POPULAR_SOURCES.filter(s => s.category === cat.id).length;
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it("has 20 sources across 4 categories", () => {
    expect(POPULAR_SOURCES.length).toBe(20);
    expect(CATALOG_CATEGORIES.length).toBe(4);
  });
});
