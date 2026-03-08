/**
 * @jest-environment jsdom
 *
 * Tests for Home Feed right sidebar — layout, metrics placement, Agent Knowledge,
 * Top Sources, Top Topics, Chrome CTA, desktop/mobile split, edge cases.
 */

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import type { ContentItem } from "@/lib/types/content";

// ─── Mocks ───

const mockProfile = {
  topicAffinities: {} as Record<string, number>,
  authorTrust: {} as Record<string, { trust: number; interactions: number }>,
  recentTopics: [] as Array<{ topic: string; timestamp: number }>,
  totalValidated: 0,
  totalFlagged: 0,
  calibration: { qualityThreshold: 6.0 },
  bookmarkedIds: [] as string[],
};

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({ filterMode: "lite", setFilterMode: jest.fn() }),
}));

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: mockProfile,
    setTopicAffinity: jest.fn(),
    removeTopicAffinity: jest.fn(),
    setQualityThreshold: jest.fn(),
    addFilterRule: jest.fn(),
    bookmarkItem: jest.fn(),
    unbookmarkItem: jest.fn(),
  }),
}));

jest.mock("@/components/ui/D2ANetworkMini", () => ({
  D2ANetworkMini: () => null,
}));

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({ sources: [{ id: "s1", type: "rss", url: "https://example.com/rss" }] }),
}));

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: false }),
}));

// ─── Setup ───

beforeEach(() => {
  localStorage.clear();
  mockProfile.topicAffinities = {};
  mockProfile.authorTrust = {};
  mockProfile.totalValidated = 0;
  mockProfile.totalFlagged = 0;
  mockProfile.bookmarkedIds = [];
});

// ─── Helpers ───

const now = Date.now();
let _seq = 0;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const n = _seq++;
  return {
    id: `sb-${n}`,
    owner: "test",
    author: "Author",
    avatar: "A",
    text: `Sidebar test ${n} ${Math.random().toString(36).slice(2)}`,
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "ok",
    createdAt: now - n * 60000,
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["test"],
    ...overrides,
  };
}

const noop = jest.fn();

// ─── Sidebar Layout ───

describe("DashboardTab — Sidebar layout", () => {
  it("renders sidebar on desktop (mobile=false)", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    expect(screen.getByTestId("aegis-feed-sidebar")).toBeTruthy();
  });

  it("does NOT render sidebar on mobile", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={true} />
    );
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
  });

  it("does NOT render sidebar in dashboard mode", () => {
    localStorage.setItem("aegis-home-mode", "dashboard");
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
  });

  it("sidebar disappears when switching to dashboard mode", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    expect(screen.getByTestId("aegis-feed-sidebar")).toBeTruthy();

    fireEvent.click(screen.getByTestId("aegis-home-mode-dashboard"));
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
  });

  it("sidebar reappears when switching back to feed mode", () => {
    localStorage.setItem("aegis-home-mode", "dashboard");
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();

    fireEvent.click(screen.getByTestId("aegis-home-mode-feed"));
    expect(screen.getByTestId("aegis-feed-sidebar")).toBeTruthy();
  });
});

// ─── Metrics Bar placement ───

describe("DashboardTab — Metrics bar placement", () => {
  it("metrics bar is inside sidebar on desktop", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    const metricsBar = screen.getByTestId("aegis-metrics-bar");
    expect(sidebar.contains(metricsBar)).toBe(true);
  });

  it("metrics bar is NOT inside sidebar on mobile (inline)", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={true} />
    );
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
    expect(screen.getByTestId("aegis-metrics-bar")).toBeTruthy();
  });

  it("metrics bar shows correct counts on desktop sidebar", () => {
    const items = [
      makeItem({ verdict: "quality", createdAt: now - 1000 }),
      makeItem({ verdict: "quality", createdAt: now - 2000 }),
      makeItem({ verdict: "slop", createdAt: now - 3000 }),
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const metricsBar = screen.getByTestId("aegis-metrics-bar");
    expect(metricsBar.textContent).toContain("2"); // quality
    expect(metricsBar.textContent).toContain("1"); // slop
    expect(metricsBar.textContent).toContain("3"); // eval
  });

  it("metrics bar shows correct counts on mobile inline", () => {
    const items = [
      makeItem({ verdict: "quality", createdAt: now - 1000 }),
      makeItem({ verdict: "slop", createdAt: now - 2000 }),
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={true} />
    );
    const metricsBar = screen.getByTestId("aegis-metrics-bar");
    expect(metricsBar.textContent).toContain("1"); // quality
    expect(metricsBar.textContent).toContain("1"); // slop
    expect(metricsBar.textContent).toContain("2"); // eval
  });

  it("metrics bar handles zero content gracefully", () => {
    // No items means no metrics bar rendered (empty state shows instead)
    // But with isLoading we still get the sidebar on desktop
    render(
      <DashboardTab content={[]} onValidate={noop} onFlag={noop} mobile={false} isLoading={true} />
    );
    const metricsBar = screen.getByTestId("aegis-metrics-bar");
    expect(metricsBar.textContent).toContain("0");
  });
});

// ─── Top Sources ───

describe("DashboardTab — Top Sources", () => {
  it("shows top 3 sources ranked by count in correct order", () => {
    const items = [
      makeItem({ source: "rss" }),
      makeItem({ source: "rss" }),
      makeItem({ source: "rss" }),
      makeItem({ source: "nostr" }),
      makeItem({ source: "nostr" }),
      makeItem({ source: "farcaster" }),
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    const sourcesSection = Array.from(sidebar.children).find(el => el.textContent?.includes("Top Sources"));
    expect(sourcesSection).toBeTruthy();
    const sourceRows = sourcesSection!.querySelectorAll(".flex.items-center.gap-2.text-body-sm");
    expect(sourceRows.length).toBe(3);
    // Verify order: rss(3) > nostr(2) > farcaster(1)
    expect(sourceRows[0].textContent).toContain("rss");
    expect(sourceRows[0].textContent).toContain("3");
    expect(sourceRows[1].textContent).toContain("nostr");
    expect(sourceRows[1].textContent).toContain("2");
    expect(sourceRows[2].textContent).toContain("farcaster");
    expect(sourceRows[2].textContent).toContain("1");
  });

  it("shows correct counts next to source names", () => {
    const items = [
      makeItem({ source: "rss" }),
      makeItem({ source: "rss" }),
      makeItem({ source: "nostr" }),
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    // Find source entries — each row has: rank, name, count
    const rows = sidebar.querySelectorAll(".flex.items-center.gap-2.text-body-sm");
    // Filter to Top Sources rows (those inside the sources card, which has "Top Sources" heading)
    const sourcesSection = Array.from(sidebar.children).find(el => el.textContent?.includes("Top Sources"));
    expect(sourcesSection).toBeTruthy();
    const sourceRows = sourcesSection!.querySelectorAll(".flex.items-center.gap-2.text-body-sm");
    expect(sourceRows.length).toBe(2); // rss and nostr
    // First row: rss with count 2
    expect(sourceRows[0].textContent).toContain("rss");
    expect(sourceRows[0].textContent).toContain("2");
    // Second row: nostr with count 1
    expect(sourceRows[1].textContent).toContain("nostr");
    expect(sourceRows[1].textContent).toContain("1");
  });

  it("uses platform field when available, falls back to source", () => {
    const items = [
      makeItem({ source: "rss", platform: "youtube" }),
      makeItem({ source: "rss", platform: "youtube" }),
      makeItem({ source: "nostr" }), // no platform
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).toContain("youtube");
    expect(sidebar.textContent).toContain("nostr");
  });

  it("does not show Top Sources when content is empty", () => {
    render(
      <DashboardTab content={[]} onValidate={noop} onFlag={noop} mobile={false} isLoading={true} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).not.toContain("Top Sources");
  });

  it("shows fewer than 3 sources when only 1–2 exist", () => {
    const items = [makeItem({ source: "rss" })];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).toContain("Top Sources");
    expect(sidebar.textContent).toContain("rss");
  });

  it("does not render Top Sources on mobile", () => {
    const items = [
      makeItem({ source: "rss" }),
      makeItem({ source: "nostr" }),
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={true} />
    );
    // No sidebar = no Top Sources
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
  });
});

// ─── Top Topics ───

describe("DashboardTab — Top Topics", () => {
  it("shows top 5 topics ranked by affinity score", () => {
    mockProfile.topicAffinities = {
      "AI": 0.9,
      "Crypto": 0.7,
      "Politics": 0.5,
      "Sports": 0.3,
      "Music": 0.2,
      "Film": 0.1,
    };
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).toContain("Top Topics");
    expect(sidebar.textContent).toContain("AI");
    expect(sidebar.textContent).toContain("Crypto");
    expect(sidebar.textContent).toContain("Politics");
    expect(sidebar.textContent).toContain("Sports");
    expect(sidebar.textContent).toContain("Music");
    // Film (0.1) should not appear — only top 5
    expect(sidebar.textContent).not.toContain("Film");
  });

  it("shows affinity scores next to topic names", () => {
    mockProfile.topicAffinities = { "AI": 0.9, "Crypto": 0.7 };
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).toContain("0.9");
    expect(sidebar.textContent).toContain("0.7");
  });

  it("does not show Top Topics when affinities are empty", () => {
    mockProfile.topicAffinities = {};
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).not.toContain("Top Topics");
  });

  it("shows fewer than 3 topics when only 1–2 exist", () => {
    mockProfile.topicAffinities = { "AI": 0.8 };
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).toContain("Top Topics");
    expect(sidebar.textContent).toContain("AI");
    expect(sidebar.textContent).toContain("0.8");
  });

  it("handles negative affinity scores in correct order", () => {
    mockProfile.topicAffinities = { "AI": 0.8, "Spam": -0.5, "Crypto": 0.3 };
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    const topicsSection = Array.from(sidebar.children).find(el => el.textContent?.includes("Top Topics"));
    expect(topicsSection).toBeTruthy();
    const topicRows = topicsSection!.querySelectorAll(".flex.items-center.gap-2.text-body-sm");
    expect(topicRows.length).toBe(3);
    // Verify descending order: AI(0.8) > Crypto(0.3) > Spam(-0.5)
    expect(topicRows[0].textContent).toContain("AI");
    expect(topicRows[0].textContent).toContain("0.8");
    expect(topicRows[1].textContent).toContain("Crypto");
    expect(topicRows[1].textContent).toContain("0.3");
    expect(topicRows[2].textContent).toContain("Spam");
    expect(topicRows[2].textContent).toContain("-0.5");
  });

  it("does not render Top Topics on mobile", () => {
    mockProfile.topicAffinities = { "AI": 0.9 };
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={true} />
    );
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
  });
});

// ─── Agent Knowledge placement ───

describe("DashboardTab — Agent Knowledge placement", () => {
  beforeEach(() => {
    // Need enough data for agent context to render
    mockProfile.totalValidated = 3;
    mockProfile.totalFlagged = 1;
    mockProfile.topicAffinities = { "AI": 0.8, "Crypto": 0.5 };
    mockProfile.authorTrust = { "Alice": { trust: 0.8, interactions: 5 } };
  });

  it("Agent Knowledge card is inside sidebar on desktop", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).toContain("Your Agent Knows");
  });

  it("Agent Knowledge card is inline on mobile (not in sidebar)", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={true} />
    );
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
    const dashboard = screen.getByTestId("aegis-dashboard");
    expect(dashboard.textContent).toContain("Your Agent Knows");
  });

  it("does not show Agent Knowledge when profile has insufficient data", () => {
    mockProfile.totalValidated = 0;
    mockProfile.totalFlagged = 0;
    mockProfile.topicAffinities = {};
    mockProfile.authorTrust = {};
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).not.toContain("Your Agent Knows");
  });

  it("does not render empty wrapper div on mobile when agent context is null", () => {
    mockProfile.totalValidated = 0;
    mockProfile.totalFlagged = 0;
    mockProfile.topicAffinities = {};
    mockProfile.authorTrust = {};
    const { container } = render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={true} />
    );
    // No "Your Agent Knows" text, and no empty mt-4 wrapper div for it
    expect(container.textContent).not.toContain("Your Agent Knows");
    // The mt-4 wrapper should not exist when agentKnowsCard is null
    const emptyDivs = container.querySelectorAll(".mt-4");
    for (const div of Array.from(emptyDivs)) {
      // If an mt-4 div exists, it should not be empty
      expect(div.children.length).toBeGreaterThan(0);
    }
  });
});

// ─── Chrome CTA placement ───

describe("DashboardTab — Chrome CTA placement", () => {
  it("Chrome CTA is inside sidebar on desktop feed", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).toContain("Aegis Score for Chrome");
  });

  it("Chrome CTA is at bottom on mobile feed", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={true} />
    );
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
    const dashboard = screen.getByTestId("aegis-dashboard");
    expect(dashboard.textContent).toContain("Aegis Score for Chrome");
  });

  it("Chrome CTA is at bottom in dashboard mode", () => {
    localStorage.setItem("aegis-home-mode", "dashboard");
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    expect(screen.queryByTestId("aegis-feed-sidebar")).toBeNull();
    const dashboard = screen.getByTestId("aegis-dashboard");
    expect(dashboard.textContent).toContain("Aegis Score for Chrome");
  });

  it("Chrome CTA links have correct attributes", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const links = document.querySelectorAll('a[href*="chromewebstore.google.com"]');
    expect(links.length).toBeGreaterThanOrEqual(1);
    const link = links[0] as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.rel).toContain("noreferrer");
  });

  it("desktop feed mode does NOT duplicate Chrome CTA at bottom", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    // Should only have ONE Chrome CTA link (in sidebar)
    const links = document.querySelectorAll('a[href*="chromewebstore.google.com"]');
    expect(links.length).toBe(1);
  });

  it("mobile feed mode has exactly one Chrome CTA (at bottom)", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={true} />
    );
    const links = document.querySelectorAll('a[href*="chromewebstore.google.com"]');
    expect(links.length).toBe(1);
  });
});

// ─── Sidebar section ordering ───

describe("DashboardTab — Sidebar section ordering", () => {
  it("sections appear in correct order: Metrics → Agent → Sources → Topics → CTA", () => {
    mockProfile.totalValidated = 3;
    mockProfile.totalFlagged = 1;
    mockProfile.topicAffinities = { "AI": 0.8 };
    mockProfile.authorTrust = { "Alice": { trust: 0.8, interactions: 5 } };

    const items = [makeItem({ source: "rss" }), makeItem({ source: "nostr" })];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    const text = sidebar.textContent!;

    const metricsIdx = text.indexOf("quality");
    const agentIdx = text.indexOf("Your Agent Knows");
    const sourcesIdx = text.indexOf("Top Sources");
    const topicsIdx = text.indexOf("Top Topics");
    const ctaIdx = text.indexOf("Aegis Score for Chrome");

    expect(metricsIdx).toBeLessThan(agentIdx);
    expect(agentIdx).toBeLessThan(sourcesIdx);
    expect(sourcesIdx).toBeLessThan(topicsIdx);
    expect(topicsIdx).toBeLessThan(ctaIdx);
  });
});

// ─── Edge cases ───

describe("DashboardTab — Sidebar edge cases", () => {
  it("sidebar renders with only 1 content item", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    expect(screen.getByTestId("aegis-feed-sidebar")).toBeTruthy();
  });

  it("sidebar renders with loading state and no content", () => {
    render(
      <DashboardTab content={[]} onValidate={noop} onFlag={noop} mobile={false} isLoading={true} />
    );
    expect(screen.getByTestId("aegis-feed-sidebar")).toBeTruthy();
    expect(screen.getByTestId("aegis-metrics-bar")).toBeTruthy();
  });

  it("sidebar renders when mobile prop is undefined (treated as desktop)", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} />
    );
    // mobile is undefined → falsy → sidebar should render
    expect(screen.getByTestId("aegis-feed-sidebar")).toBeTruthy();
  });

  it("Top Sources handles all items having same source", () => {
    const items = [
      makeItem({ source: "rss" }),
      makeItem({ source: "rss" }),
      makeItem({ source: "rss" }),
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    const sourcesSection = Array.from(sidebar.children).find(el => el.textContent?.includes("Top Sources"));
    expect(sourcesSection).toBeTruthy();
    const sourceRows = sourcesSection!.querySelectorAll(".flex.items-center.gap-2.text-body-sm");
    // Exactly 1 source entry
    expect(sourceRows.length).toBe(1);
    expect(sourceRows[0].textContent).toContain("rss");
    expect(sourceRows[0].textContent).toContain("3");
  });

  it("Top Topics handles very small affinity values", () => {
    mockProfile.topicAffinities = { "AI": 0.001 };
    render(
      <DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    expect(sidebar.textContent).toContain("AI");
    expect(sidebar.textContent).toContain("0.0"); // toFixed(1) rounds 0.001 → "0.0"
  });

  it("handles content with missing platform field", () => {
    const items = [
      makeItem({ source: "rss", platform: undefined }),
      makeItem({ source: "nostr", platform: undefined }),
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    const sidebar = screen.getByTestId("aegis-feed-sidebar");
    // Falls back to source field
    expect(sidebar.textContent).toContain("rss");
    expect(sidebar.textContent).toContain("nostr");
  });

  it("content list still works with sidebar present", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `list-${i}`, createdAt: now - i * 1000 })
    );
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    // All 8 items visible (< BATCH_SIZE of 40)
    const cards = document.querySelectorAll('[data-testid="aegis-content-card"]');
    expect(cards.length).toBe(8);
    // No "Load remaining" since 8 < 40
    expect(screen.queryByText(/Load remaining/)).toBeNull();
  });

  it("filter buttons still work with sidebar present", () => {
    const items = [
      makeItem({ verdict: "quality" }),
      makeItem({ verdict: "slop" }),
    ];
    render(
      <DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />
    );
    // Open more filters, select slop
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    fireEvent.click(screen.getByTestId("aegis-filter-slop"));
    // Only slop item visible
    const cards = document.querySelectorAll('[data-testid="aegis-content-card"]');
    expect(cards.length).toBe(1);
    // Sidebar still present
    expect(screen.getByTestId("aegis-feed-sidebar")).toBeTruthy();
  });
});
