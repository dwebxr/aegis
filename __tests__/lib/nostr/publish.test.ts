import { buildAegisTags } from "@/lib/nostr/publish";

describe("buildAegisTags", () => {
  it("always includes aegis version, score, and client tags", () => {
    const tags = buildAegisTags(7.5, undefined, []);
    expect(tags).toContainEqual(["aegis", "v1"]);
    expect(tags).toContainEqual(["aegis-score", "7.5"]);
    expect(tags).toContainEqual(["client", "aegis"]);
  });

  it("formats composite to 1 decimal place", () => {
    const tags = buildAegisTags(8, undefined, []);
    expect(tags).toContainEqual(["aegis-score", "8.0"]);
  });

  it("includes vSignal tag when defined", () => {
    const tags = buildAegisTags(7.0, 9, []);
    expect(tags).toContainEqual(["aegis-vsignal", "9"]);
  });

  it("includes vSignal=0 (truthy check doesn't skip it)", () => {
    const tags = buildAegisTags(7.0, 0, []);
    expect(tags).toContainEqual(["aegis-vsignal", "0"]);
  });

  it("omits vSignal tag when undefined", () => {
    const tags = buildAegisTags(7.0, undefined, []);
    expect(tags.some(t => t[0] === "aegis-vsignal")).toBe(false);
  });

  it("adds topic tags", () => {
    const tags = buildAegisTags(7.0, undefined, ["ai", "transformers"]);
    expect(tags).toContainEqual(["t", "ai"]);
    expect(tags).toContainEqual(["t", "transformers"]);
  });

  it("handles empty topics array", () => {
    const tags = buildAegisTags(5.0, undefined, []);
    expect(tags.filter(t => t[0] === "t")).toHaveLength(0);
  });

  it("handles many topics", () => {
    const topics = Array.from({ length: 20 }, (_, i) => `topic-${i}`);
    const tags = buildAegisTags(7.0, undefined, topics);
    expect(tags.filter(t => t[0] === "t")).toHaveLength(20);
  });

  it("preserves special characters in topics", () => {
    const tags = buildAegisTags(7.0, undefined, ["C++", "machine-learning"]);
    expect(tags).toContainEqual(["t", "C++"]);
    expect(tags).toContainEqual(["t", "machine-learning"]);
  });

  it("returns correct total tag count", () => {
    // 3 base tags (aegis, score, client) + 1 vSignal + 2 topics = 6
    const tags = buildAegisTags(7.0, 8, ["ai", "ml"]);
    expect(tags).toHaveLength(6);
  });
});
