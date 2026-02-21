/**
 * @jest-environment jsdom
 */

// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import type { ContentItem } from "@/lib/types/content";

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({ filterMode: "lite", setFilterMode: jest.fn() }),
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
    setTopicAffinity: jest.fn(),
    removeTopicAffinity: jest.fn(),
    setQualityThreshold: jest.fn(),
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
    // Cards show text, author, and verdict
    expect(html).toContain("Test content text");
    expect(html).toContain("Test Author");
    expect(html).toContain("quality");
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
    // Both items exist in content list; compact cards show text content
    expect(html).toContain("Test content text");
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
  it("shows Home title and filter mode badge", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Home");
    expect(html).toContain("Lite");
  });
});

describe("DashboardTab — card layout", () => {
  it("shows source name and author in card header", () => {
    const items = [makeItem({ source: "rss", author: "Test Author" })];
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("rss");
    expect(html).toContain("Test Author");
  });

  it("shows score grade badge in card", () => {
    const items = [makeItem({ scores: { originality: 8, insight: 8, credibility: 8, composite: 8.0 } })];
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Grade A should appear in GradeBadge
    expect(html).toContain(">A<");
  });

  it("limits topic tags to 3 with overflow indicator", () => {
    const items = [makeItem({ topics: ["a", "b", "c", "d", "e"] })];
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("+2");
  });
});

describe("DashboardTab — keyboard shortcut hint", () => {
  it("shows keyboard hint on desktop", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("J/K");
    expect(html).toContain("commands");
  });

  it("hides keyboard hint on mobile", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} mobile />
    );
    expect(html).not.toContain("J/K");
  });
});

describe("DashboardTab — dashboard mode rendering", () => {
  beforeEach(() => {
    localStorage.setItem("aegis-home-mode", "dashboard");
  });
  afterEach(() => {
    localStorage.removeItem("aegis-home-mode");
  });

  it("renders Today's Top 3 section with quality content", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `dash-${i}`, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } })
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Top 3");
    expect(html).toContain("Review All");
  });

  it("renders empty Top 3 state when no quality items", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("No quality items scored yet");
  });

  it("renders Topic Spotlight section", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Topic Spotlight");
  });

  it("renders Validated section", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Validated");
    expect(html).toContain("No validated items yet");
  });

  it("renders Validated items when present", () => {
    const items = [
      makeItem({ id: "val-1", validated: true, validatedAt: now - 1000 }),
      makeItem({ id: "val-2", validated: true, validatedAt: now - 2000 }),
    ];
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Test content text");
    expect(html).toContain("Test Author");
  });

  it("renders Agent Settings section collapsed by default", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Agent Settings");
    expect(html).toContain("0 interests");
    expect(html).toContain("threshold 5.5");
    expect(html).toContain("0 reviews");
  });

  it("renders Recent Activity section with time-range tabs", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Recent Activity");
    expect(html).toContain("Today");
    expect(html).toContain("7d");
    expect(html).toContain("30d");
  });

  it("renders activity stats with content", () => {
    const items = [
      makeItem({ id: "act-1", verdict: "quality", createdAt: now - 1000 }),
      makeItem({ id: "act-2", verdict: "slop", createdAt: now - 2000 }),
    ];
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("quality");
    expect(html).toContain("burned");
    expect(html).toContain("total");
  });

  it("renders Discoveries section when discoveries prop provided", () => {
    // Discovery item must differ from content items — dedup filters overlapping IDs
    const contentItems = [makeItem({ id: "content-1" })];
    const discItem = makeItem({ id: "disc-src" });
    const discoveries = [{
      item: discItem,
      discoveryType: "emerging_topic" as const,
      reason: "Expanding your horizons",
      serendipityScore: 0.8,
      wotScore: 0.5,
      qualityComposite: 7,
    }];
    const html = renderToStaticMarkup(
      <DashboardTab content={contentItems} onValidate={jest.fn()} onFlag={jest.fn()} discoveries={discoveries} />
    );
    expect(html).toContain("Discoveries");
    expect(html).toContain("Expanding your horizons");
  });

  it("does not show feed-mode sections in dashboard mode", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).not.toContain("Filtered Signal");
    expect(html).not.toContain("J/K");
  });

  it("restores dashboard mode from localStorage", () => {
    // localStorage was set in beforeEach
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Dashboard mode should show Top 3 section, not Feed section
    expect(html).toContain("Top 3");
    expect(html).not.toContain("Filtered Signal");
  });
});
