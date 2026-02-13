import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import type { ContentItem } from "@/lib/types/content";

jest.mock("@/components/filtering/FilterModeSelector", () => ({
  FilterModeSelector: () => React.createElement("div", { "data-testid": "filter-mode-selector" }, "FilterMode"),
}));

const now = Date.now();
const dayMs = 86400000;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: Math.random().toString(36),
    owner: "test-owner",
    author: "Test Author",
    avatar: "T",
    text: "Test content text",
    source: "manual",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7.0 },
    verdict: "quality",
    reason: "Test reason",
    createdAt: now - 1000, // within last 24h
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["test"],
    ...overrides,
  };
}

describe("DashboardTab — empty state", () => {
  it("shows 'No content yet' when content is empty", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("No content yet");
    expect(html).toContain("Add sources or analyze content");
  });

  it("shows zero stats when content is empty", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Quality");
    expect(html).toContain("Burned");
    expect(html).toContain("Evaluated");
    expect(html).toContain("Sources");
  });

  it("does not show export buttons when empty", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).not.toContain("Export CSV");
    expect(html).not.toContain("Export JSON");
  });
});

describe("DashboardTab — with content", () => {
  const items: ContentItem[] = [
    makeItem({ id: "q1", verdict: "quality", source: "rss" }),
    makeItem({ id: "q2", verdict: "quality", source: "nostr" }),
    makeItem({ id: "s1", verdict: "slop", source: "rss" }),
  ];

  it("shows correct today stats", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // 2 quality items
    expect(html).toContain("2");
    // 1 slop item
    expect(html).toContain("1");
    // 3 evaluated
    expect(html).toContain("3");
    // 2 unique sources (rss, nostr)
    expect(html).toContain("2");
  });

  it("shows export buttons when content exists", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Export CSV");
    expect(html).toContain("Export JSON");
  });

  it("shows filter buttons (all, quality, slop)", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("all");
    expect(html).toContain("quality");
    expect(html).toContain("slop");
  });

  it("shows source filter when multiple sources exist", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("all sources");
    expect(html).toContain("rss");
    expect(html).toContain("nostr");
  });

  it("renders content cards", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Test Author");
    expect(html).toContain("Test content text");
  });
});

describe("DashboardTab — loading state", () => {
  it("shows loading indicator when isLoading is true", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} isLoading />
    );
    expect(html).toContain("Loading content");
    expect(html).toContain("Syncing from Internet Computer");
  });

  it("does not show 'No content yet' when loading", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} isLoading />
    );
    expect(html).not.toContain("No content yet");
  });
});

describe("DashboardTab — WoT loading", () => {
  it("shows WoT loading indicator", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} wotLoading />
    );
    expect(html).toContain("Building Web of Trust graph");
  });
});

describe("DashboardTab — mobile mode", () => {
  it("renders without error in mobile mode", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} mobile />
    );
    expect(html).toContain("Aegis Dashboard");
  });
});

describe("DashboardTab — show all button", () => {
  it("shows 'Show all' button when more than 5 items", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `item-${i}` })
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Show all");
    expect(html).toContain("8 items");
  });

  it("does not show 'Show all' button when 5 or fewer items", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `item-${i}` })
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).not.toContain("Show all");
  });
});

describe("DashboardTab — charts", () => {
  it("renders Filter Accuracy and Slop Volume charts", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Filter Accuracy");
    expect(html).toContain("Slop Volume");
    expect(html).toContain("7-day");
  });
});

describe("DashboardTab — old content (outside 24h)", () => {
  it("counts items correctly when content is older than 24h", () => {
    const oldItem = makeItem({
      id: "old-1",
      createdAt: now - 2 * dayMs, // 2 days ago
    });
    const recentItem = makeItem({
      id: "recent-1",
      createdAt: now - 1000, // just now
    });
    const html = renderToStaticMarkup(
      <DashboardTab content={[oldItem, recentItem]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Only 1 recent item in "last 24h" stats
    expect(html).toContain("of 1 in last 24h");
  });
});

describe("DashboardTab — single source", () => {
  it("does not show source filter when only one source", () => {
    const items = [
      makeItem({ id: "1", source: "rss" }),
      makeItem({ id: "2", source: "rss" }),
    ];
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // No source dropdown when only 1 source
    expect(html).not.toContain("all sources");
  });
});

describe("DashboardTab — hero section", () => {
  it("shows description text", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Content quality filter");
    expect(html).toContain("zero-noise briefing");
  });

  it("includes FilterModeSelector", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("FilterMode");
  });
});
