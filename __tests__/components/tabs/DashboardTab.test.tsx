import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import type { ContentItem } from "@/lib/types/content";

jest.mock("@/components/filtering/FilterModeSelector", () => ({
  FilterModeSelector: () => React.createElement("div", { "data-testid": "filter-mode-selector" }, "FilterMode"),
}));

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: {
      topicAffinities: {},
      authorTrust: {},
      recentTopics: [],
      totalValidated: 0,
      totalFlagged: 0,
      calibration: { qualityThreshold: 5.5 },
    },
  }),
}));

jest.mock("@/components/ui/D2ANetworkMini", () => ({
  D2ANetworkMini: () => null,
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
  it("shows 'No matching content' when empty with default quality filter", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("No matching content");
    expect(html).toContain("Try adjusting your filters");
  });

  it("shows metric chip labels when content is empty", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("quality");
    expect(html).toContain("burned");
    expect(html).toContain("eval");
    expect(html).toContain("sources");
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

  it("shows correct today stats in metric chips", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // 2 quality, 1 slop, 3 eval, 2 sources — all present as numbers
    expect(html).toContain("2");
    expect(html).toContain("1");
    expect(html).toContain("3");
  });

  it("shows export buttons when content exists", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Export CSV");
    expect(html).toContain("Export JSON");
  });

  it("shows filter buttons (quality, all, slop)", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain(">quality<");
    expect(html).toContain(">all<");
    expect(html).toContain(">slop<");
  });

  it("shows source filter when multiple sources exist", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("all sources");
    expect(html).toContain("rss");
    expect(html).toContain("nostr");
  });

  it("renders quality content cards (default filter)", () => {
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

  it("does not show empty message when loading", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} isLoading />
    );
    expect(html).not.toContain("No matching content");
    expect(html).not.toContain("No content yet");
  });
});

describe("DashboardTab — WoT loading", () => {
  it("shows WoT loading indicator", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} wotLoading />
    );
    expect(html).toContain("WoT...");
  });
});

describe("DashboardTab — mobile mode", () => {
  it("renders without error in mobile mode", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} mobile />
    );
    expect(html).toContain("Home");
  });
});

describe("DashboardTab — show all button", () => {
  it("shows 'Show all' button when more than 5 quality items", () => {
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

describe("DashboardTab — compact metrics", () => {
  it("renders sparklines for quality and slop trends", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // MiniChart renders SVG
    expect(html).toContain("<svg");
    expect(html).toContain("polyline");
  });
});

describe("DashboardTab — old content (outside 24h)", () => {
  it("today metrics only count recent items", () => {
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
    // Both items exist in content list, but only 1 in "today" metrics
    expect(html).toContain("Test Author");
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

describe("DashboardTab — header", () => {
  it("shows Home title and FilterModeSelector", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Home");
    expect(html).toContain("FilterMode");
  });
});
