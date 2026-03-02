import { computeTopicTrends } from "@/lib/dashboard/utils";
import type { ContentItem } from "@/lib/types/content";

const DAY = 86400000;
const WEEK = 7 * DAY;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test",
    author: "Author",
    avatar: "A",
    text: "Test content",
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now() - 1 * DAY,
    validated: false,
    flagged: false,
    timestamp: "1d ago",
    ...overrides,
  };
}

describe("computeTopicTrends", () => {
  it("returns empty for empty content", () => {
    expect(computeTopicTrends([])).toEqual([]);
  });

  it("computes trends for a single topic in one week", () => {
    const items = [
      makeItem({ topics: ["bitcoin"], createdAt: Date.now() - 1 * DAY }),
      makeItem({ topics: ["bitcoin"], createdAt: Date.now() - 2 * DAY }),
    ];
    const trends = computeTopicTrends(items);
    expect(trends).toHaveLength(1);
    expect(trends[0].topic).toBe("bitcoin");
    expect(trends[0].currentCount).toBe(2);
    expect(trends[0].previousCount).toBe(0);
    expect(trends[0].changePercent).toBe(100);
    expect(trends[0].direction).toBe("up");
  });

  it("detects declining topics", () => {
    const now = Date.now();
    const items = [
      // Current week: 1 item
      makeItem({ topics: ["defi"], createdAt: now - 1 * DAY }),
      // Previous week: 5 items
      ...Array.from({ length: 5 }, (_, i) =>
        makeItem({ topics: ["defi"], createdAt: now - (8 + i) * DAY }),
      ),
    ];
    const trends = computeTopicTrends(items);
    const defi = trends.find(t => t.topic === "defi");
    expect(defi).toBeDefined();
    expect(defi!.direction).toBe("down");
    expect(defi!.changePercent).toBe(-80);
  });

  it("marks stable topics (within ±10%)", () => {
    const now = Date.now();
    const items = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeItem({ topics: ["eth"], createdAt: now - (i % 7 + 1) * DAY }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeItem({ topics: ["eth"], createdAt: now - (8 + i % 7) * DAY }),
      ),
    ];
    const trends = computeTopicTrends(items);
    const eth = trends.find(t => t.topic === "eth");
    expect(eth).toBeDefined();
    expect(eth!.direction).toBe("stable");
  });

  it("limits to 8 topics", () => {
    const now = Date.now();
    const items: ContentItem[] = [];
    for (let i = 0; i < 12; i++) {
      items.push(makeItem({
        topics: [`topic-${i}`],
        createdAt: now - 1 * DAY,
      }));
    }
    const trends = computeTopicTrends(items);
    expect(trends.length).toBeLessThanOrEqual(8);
  });

  it("sorts by current count descending", () => {
    const now = Date.now();
    const items = [
      ...Array.from({ length: 5 }, () => makeItem({ topics: ["popular"], createdAt: now - DAY })),
      ...Array.from({ length: 2 }, () => makeItem({ topics: ["rare"], createdAt: now - DAY })),
    ];
    const trends = computeTopicTrends(items);
    expect(trends[0].topic).toBe("popular");
    expect(trends[1].topic).toBe("rare");
  });

  it("provides weeklyHistory in oldest-first order", () => {
    const now = Date.now();
    const items = [
      makeItem({ topics: ["test"], createdAt: now - 1 * DAY }),    // week 0
      makeItem({ topics: ["test"], createdAt: now - 1 * DAY }),    // week 0
      makeItem({ topics: ["test"], createdAt: now - 10 * DAY }),   // week 1
    ];
    const trends = computeTopicTrends(items);
    const test = trends.find(t => t.topic === "test");
    expect(test).toBeDefined();
    // weeklyHistory: [week3, week2, week1, week0] = oldest first
    expect(test!.weeklyHistory[test!.weeklyHistory.length - 1]).toBe(2); // most recent
    expect(test!.weeklyHistory).toHaveLength(4);
  });

  it("normalizes topic names to lowercase", () => {
    const now = Date.now();
    const items = [
      makeItem({ topics: ["Bitcoin"], createdAt: now - DAY }),
      makeItem({ topics: ["bitcoin"], createdAt: now - DAY }),
      makeItem({ topics: ["BITCOIN"], createdAt: now - DAY }),
    ];
    const trends = computeTopicTrends(items);
    expect(trends).toHaveLength(1);
    expect(trends[0].topic).toBe("bitcoin");
    expect(trends[0].currentCount).toBe(3);
  });

  it("handles items with no topics", () => {
    const items = [
      makeItem({ createdAt: Date.now() - DAY }),
      makeItem({ topics: ["bitcoin"], createdAt: Date.now() - DAY }),
    ];
    const trends = computeTopicTrends(items);
    expect(trends).toHaveLength(1);
    expect(trends[0].topic).toBe("bitcoin");
  });

  it("handles boundary: exactly +10% is stable", () => {
    const now = Date.now();
    // prev=10, current=11 → +10% → stable (boundary)
    const items = [
      ...Array.from({ length: 11 }, () => makeItem({ topics: ["test"], createdAt: now - DAY })),
      ...Array.from({ length: 10 }, () => makeItem({ topics: ["test"], createdAt: now - 10 * DAY })),
    ];
    const trends = computeTopicTrends(items);
    expect(trends[0].direction).toBe("stable");
    expect(trends[0].changePercent).toBe(10);
  });

  it("handles boundary: +11% or more is up", () => {
    const now = Date.now();
    // prev=9, current=10 → +11.1% → up
    const items = [
      ...Array.from({ length: 10 }, () => makeItem({ topics: ["test"], createdAt: now - DAY })),
      ...Array.from({ length: 9 }, () => makeItem({ topics: ["test"], createdAt: now - 10 * DAY })),
    ];
    const trends = computeTopicTrends(items);
    expect(trends[0].direction).toBe("up");
  });
});
