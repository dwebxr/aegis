/**
 * Tests for demo mode constants and source validation.
 */
import { DEMO_SOURCES } from "@/lib/demo/sources";

describe("DEMO_SOURCES", () => {
  it("contains exactly 3 sources", () => {
    expect(DEMO_SOURCES).toHaveLength(3);
  });

  it("all sources have type rss", () => {
    for (const s of DEMO_SOURCES) {
      expect(s.type).toBe("rss");
    }
  });

  it("all sources are enabled", () => {
    for (const s of DEMO_SOURCES) {
      expect(s.enabled).toBe(true);
    }
  });

  it("all sources have valid feedUrl starting with https://", () => {
    for (const s of DEMO_SOURCES) {
      expect(s.feedUrl).toBeDefined();
      expect(s.feedUrl).toMatch(/^https:\/\//);
    }
  });

  it("all source IDs are unique and prefixed with demo-", () => {
    const ids = DEMO_SOURCES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^demo-/);
    }
  });

  it("all sources have a non-empty label", () => {
    for (const s of DEMO_SOURCES) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("includes Hacker News, CoinDesk, and The Verge", () => {
    const labels = DEMO_SOURCES.map(s => s.label);
    expect(labels).toContain("Hacker News");
    expect(labels).toContain("CoinDesk");
    expect(labels).toContain("The Verge");
  });

  it("conforms to SavedSource interface", () => {
    for (const s of DEMO_SOURCES) {
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("type");
      expect(s).toHaveProperty("label");
      expect(s).toHaveProperty("enabled");
      expect(s).toHaveProperty("feedUrl");
      expect(s).toHaveProperty("createdAt");
      expect(typeof s.createdAt).toBe("number");
    }
  });
});
