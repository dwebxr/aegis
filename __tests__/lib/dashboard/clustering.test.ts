import { clusterByStory, titleWordOverlap } from "@/lib/dashboard/utils";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> & { id: string }): ContentItem {
  const now = Date.now();
  return {
    text: "Default text content",
    author: "Author",
    avatar: "A",
    source: "test",
    timestamp: "1h",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    validated: false,
    flagged: false,
    reason: "",
    createdAt: now,
    ...overrides,
  } as ContentItem;
}

describe("titleWordOverlap", () => {
  it("returns 0 for empty strings", () => {
    expect(titleWordOverlap("", "")).toBe(0);
    expect(titleWordOverlap("hello world", "")).toBe(0);
  });

  it("returns 0 for no overlap", () => {
    expect(titleWordOverlap("bitcoin halving event", "japanese food recipes")).toBe(0);
  });

  it("filters out short words (<=2 chars)", () => {
    expect(titleWordOverlap("a b c", "a b c")).toBe(0);
    expect(titleWordOverlap("ab cd", "ef gh")).toBe(0);
  });

  it("returns high overlap for similar titles", () => {
    const overlap = titleWordOverlap(
      "Ethereum execution layer proposal by Vitalik",
      "Vitalik proposes new Ethereum execution layer",
    );
    expect(overlap).toBeGreaterThanOrEqual(0.4);
  });

  it("is case insensitive", () => {
    const overlap = titleWordOverlap("Ethereum Blockchain", "ethereum blockchain");
    expect(overlap).toBe(1);
  });
});

describe("clusterByStory", () => {
  it("returns empty for empty input", () => {
    expect(clusterByStory([])).toEqual([]);
  });

  it("returns singleton for single item", () => {
    const item = makeItem({ id: "1" });
    const clusters = clusterByStory([item]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].representative).toBe(item);
    expect(clusters[0].members).toHaveLength(1);
  });

  it("clusters items with 2+ shared topics within 48h", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: ["ethereum", "blockchain", "defi"], createdAt: now, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } });
    const b = makeItem({ id: "b", topics: ["ethereum", "blockchain"], createdAt: now - 3600000, scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } });

    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].representative.id).toBe("a");
    expect(clusters[0].members).toHaveLength(2);
    expect(clusters[0].sharedTopics).toContain("ethereum");
    expect(clusters[0].sharedTopics).toContain("blockchain");
  });

  it("does not cluster items with 2+ shared topics but >48h apart", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: ["ethereum", "blockchain"], createdAt: now });
    const b = makeItem({ id: "b", topics: ["ethereum", "blockchain"], createdAt: now - 49 * 3600000 });

    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("clusters items with 1 shared topic + high title similarity", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: ["ethereum"], text: "Vitalik proposes new Ethereum execution layer changes for scalability", createdAt: now, scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } });
    const b = makeItem({ id: "b", topics: ["ethereum"], text: "Vitalik new Ethereum execution layer proposal for better scalability", createdAt: now - 3600000, scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } });

    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].representative.id).toBe("a");
  });

  it("does not cluster items with 1 shared topic + low title similarity", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: ["ethereum"], text: "Bitcoin mining difficulty hits new record", createdAt: now });
    const b = makeItem({ id: "b", topics: ["ethereum"], text: "Japanese recipe for ramen noodles", createdAt: now - 3600000 });

    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(2);
  });

  it("performs transitive clustering (A-B, B-C → ABC)", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: ["ethereum", "blockchain"], createdAt: now, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } });
    const b = makeItem({ id: "b", topics: ["ethereum", "blockchain", "defi"], createdAt: now - 1000, scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } });
    const c = makeItem({ id: "c", topics: ["blockchain", "defi"], createdAt: now - 2000, scores: { originality: 4, insight: 4, credibility: 4, composite: 4 } });

    const clusters = clusterByStory([a, b, c]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(3);
    expect(clusters[0].representative.id).toBe("a");
  });

  it("selects highest composite as representative", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: ["ai", "ml"], createdAt: now, scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } });
    const b = makeItem({ id: "b", topics: ["ai", "ml"], createdAt: now - 1000, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } });

    const clusters = clusterByStory([a, b]);
    expect(clusters[0].representative.id).toBe("b");
  });

  it("treats items without topics as singletons", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: undefined, createdAt: now });
    const b = makeItem({ id: "b", topics: [], createdAt: now });
    const c = makeItem({ id: "c", topics: ["ai", "ml"], createdAt: now });

    const clusters = clusterByStory([a, b, c]);
    expect(clusters).toHaveLength(3);
  });

  it("performs case-insensitive topic matching", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: ["Ethereum", "Blockchain"], createdAt: now, scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } });
    const b = makeItem({ id: "b", topics: ["ethereum", "blockchain"], createdAt: now - 1000, scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } });

    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(1);
  });

  it("sorts clusters by representative composite descending", () => {
    const now = Date.now();
    const a = makeItem({ id: "a", topics: ["topic-x"], createdAt: now, scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } });
    const b = makeItem({ id: "b", topics: ["topic-y"], createdAt: now, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } });

    const clusters = clusterByStory([a, b]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].representative.id).toBe("b");
    expect(clusters[1].representative.id).toBe("a");
  });

  it("handles large cluster correctly", () => {
    const now = Date.now();
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `item-${i}`, topics: ["ai", "ml"], createdAt: now - i * 1000, scores: { originality: 10 - i, insight: 10 - i, credibility: 10 - i, composite: 10 - i } }),
    );

    const clusters = clusterByStory(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(10);
    expect(clusters[0].representative.id).toBe("item-0");
  });
});
