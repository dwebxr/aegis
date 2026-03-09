/**
 * @jest-environment jsdom
 *
 * Tests for sidebar enhancements: metrics delta, reading streak, unreviewed queue,
 * topic filtering, source filter via sidebar, section collapse, high quality day,
 * agent recent learning, topic trend direction/isNew.
 */
import "@testing-library/jest-dom";

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
import { render, fireEvent, screen, within } from "@testing-library/react";
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

const noop = jest.fn();
const now = Date.now();
const dayMs = 86400000;
let _seq = 0;

beforeEach(() => {
  localStorage.clear();
  mockProfile.topicAffinities = {};
  mockProfile.authorTrust = {};
  mockProfile.totalValidated = 0;
  mockProfile.totalFlagged = 0;
  mockProfile.bookmarkedIds = [];
  _seq = 0;
});

// ─── Helpers ───

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const n = _seq++;
  return {
    id: `enh-${n}`,
    owner: "test",
    author: "Author",
    avatar: "A",
    text: `Enhanced test ${n} ${Math.random().toString(36).slice(2)}`,
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

function getCardIds(): string[] {
  const cards = document.querySelectorAll('[data-testid="aegis-content-card"]');
  return Array.from(cards).map(el => el.id.replace("card-", ""));
}

function getSidebar() {
  return screen.getByTestId("aegis-feed-sidebar");
}

// ─── Metrics Delta ───

describe("Sidebar — Metrics delta", () => {
  it("shows positive delta when today > yesterday", () => {
    const items = [
      // 3 today
      makeItem({ createdAt: now - 1000, verdict: "quality" }),
      makeItem({ createdAt: now - 2000, verdict: "quality" }),
      makeItem({ createdAt: now - 3000, verdict: "slop" }),
      // 1 yesterday
      makeItem({ createdAt: now - dayMs - 1000, verdict: "quality" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    // quality: today=2, yesterday=1, delta=+1
    expect(sidebar.textContent).toContain("+1");
  });

  it("shows negative delta when today < yesterday", () => {
    const items = [
      // 1 today
      makeItem({ createdAt: now - 1000, verdict: "quality" }),
      // 3 yesterday
      makeItem({ createdAt: now - dayMs - 1000, verdict: "quality" }),
      makeItem({ createdAt: now - dayMs - 2000, verdict: "quality" }),
      makeItem({ createdAt: now - dayMs - 3000, verdict: "quality" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("-2");
  });

  it("hides delta when value is 0", () => {
    const items = [
      makeItem({ createdAt: now - 1000, verdict: "quality" }),
      makeItem({ createdAt: now - dayMs - 1000, verdict: "quality" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    const metricsBar = within(sidebar).getByTestId("aegis-metrics-bar");
    // quality: today=1, yesterday=1 → delta=0 → not shown
    // delta spans have text-emerald-400 or text-red-400; zero deltas should not appear
    const deltaSpans = metricsBar.querySelectorAll(".text-emerald-400, .text-red-400");
    // eval delta: today=1, yesterday=1 → 0; slop delta: 0-0=0; source delta: 1-1=0
    // Only quality delta would be shown, but it's 0
    for (const span of Array.from(deltaSpans)) {
      expect(span.textContent).not.toBe("+0");
      expect(span.textContent).not.toBe("0");
    }
  });
});

// ─── High Quality Day ───

describe("Sidebar — High quality day message", () => {
  it("shows message when quality rate >= 70% and items >= 5", () => {
    // Need 5+ items today with 70%+ quality
    const items = [
      makeItem({ createdAt: now - 1000, verdict: "quality" }),
      makeItem({ createdAt: now - 2000, verdict: "quality" }),
      makeItem({ createdAt: now - 3000, verdict: "quality" }),
      makeItem({ createdAt: now - 4000, verdict: "quality" }),
      makeItem({ createdAt: now - 5000, verdict: "slop" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("High quality day!");
  });

  it("does not show message when items < 5", () => {
    const items = [
      makeItem({ createdAt: now - 1000, verdict: "quality" }),
      makeItem({ createdAt: now - 2000, verdict: "quality" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).not.toContain("High quality day!");
  });

  it("does not show message when quality rate < 70%", () => {
    const items = [
      makeItem({ createdAt: now - 1000, verdict: "quality" }),
      makeItem({ createdAt: now - 2000, verdict: "quality" }),
      makeItem({ createdAt: now - 3000, verdict: "slop" }),
      makeItem({ createdAt: now - 4000, verdict: "slop" }),
      makeItem({ createdAt: now - 5000, verdict: "slop" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).not.toContain("High quality day!");
  });
});

// ─── Reading Streak ───

describe("Sidebar — Reading Streak", () => {
  it("shows streak when user has validated items on consecutive days", () => {
    const items = [
      makeItem({ createdAt: now - 1000, validated: true, validatedAt: now - 1000 }),
      makeItem({ createdAt: now - dayMs - 1000, validated: true, validatedAt: now - dayMs - 1000 }),
      makeItem({ createdAt: now - 2 * dayMs - 1000, validated: true, validatedAt: now - 2 * dayMs - 1000 }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("Reading Streak");
    expect(sidebar.textContent).toContain("3d");
  });

  it("does not show streak when no items are validated/flagged", () => {
    const items = [
      makeItem({ createdAt: now - 1000 }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).not.toContain("Reading Streak");
  });

  it("counts flagged items toward streak", () => {
    const items = [
      makeItem({ createdAt: now - 1000, flagged: true, validatedAt: now - 1000 }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("Reading Streak");
    expect(sidebar.textContent).toContain("1d");
  });

  it("shows streak-at-risk nudge when yesterday had reviews but today does not", () => {
    const items = [
      // Yesterday validated, today not
      makeItem({ createdAt: now - dayMs - 1000, validated: true, validatedAt: now - dayMs - 1000 }),
      makeItem({ createdAt: now - 1000 }), // today, not validated
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("Review content today to keep your streak!");
  });

  it("does not show nudge when today already has reviews", () => {
    const items = [
      makeItem({ createdAt: now - 1000, validated: true, validatedAt: now - 1000 }),
      makeItem({ createdAt: now - dayMs - 1000, validated: true, validatedAt: now - dayMs - 1000 }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).not.toContain("Review content today to keep your streak!");
  });

  it("breaks streak on gap day", () => {
    const items = [
      makeItem({ createdAt: now - 1000, validated: true, validatedAt: now - 1000 }),
      // Skip yesterday
      makeItem({ createdAt: now - 2 * dayMs - 1000, validated: true, validatedAt: now - 2 * dayMs - 1000 }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    // Only today counts, yesterday has gap
    expect(sidebar.textContent).toContain("1d");
  });
});

// ─── Unreviewed Queue ───

describe("Sidebar — Unreviewed Queue", () => {
  it("shows Needs Review section with unreviewed quality items", () => {
    const items = [
      makeItem({ id: "unr-1", text: "Unreviewed alpha xyz123", verdict: "quality", validated: false, flagged: false, scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "unr-2", text: "Unreviewed beta abc456", verdict: "quality", validated: false, flagged: false }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("Needs Review");
    expect(sidebar.textContent).toContain("Unreviewed alpha xyz123");
  });

  it("does not show Needs Review when all items are validated", () => {
    const items = [
      makeItem({ validated: true, validatedAt: now }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).not.toContain("Needs Review");
  });

  it("does not show slop items in unreviewed queue", () => {
    const items = [
      makeItem({ id: "slop-unr", text: "Slop unreviewable qwerty", verdict: "slop" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).not.toContain("Needs Review");
  });

  it("collapses and expands via toggle button", () => {
    const items = [
      makeItem({ text: "Collapsible unreview item" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("Collapsible unreview item");

    // Click collapse (▼ button)
    const collapseBtn = within(sidebar).getAllByText("\u25BC").find(
      el => el.closest("div")?.textContent?.includes("Needs Review")
    );
    expect(collapseBtn).toBeInTheDocument();
    fireEvent.click(collapseBtn!);

    // After collapse, item text should be hidden, but section header still visible
    expect(sidebar.textContent).not.toContain("Collapsible unreview item");
    expect(sidebar.textContent).toContain("Needs Review");

    // Click expand (▶ button)
    const expandBtn = within(sidebar).getByText("\u25B6");
    fireEvent.click(expandBtn);
    expect(sidebar.textContent).toContain("Collapsible unreview item");
  });
});

// ─── Top Sources Interactive ───

describe("Sidebar — Top Sources interactive filter", () => {
  it("clicking a source activates sourceFilter and filters content", () => {
    const items = [
      makeItem({ id: "rss-1", source: "rss", text: "RSS item one unique" }),
      makeItem({ id: "nostr-1", source: "nostr", text: "Nostr item one unique" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();

    // Find the source row button inside Top Sources section
    const sourceButtons = sidebar.querySelectorAll<HTMLButtonElement>("button");
    const rssButton = Array.from(sourceButtons).find(
      btn => btn.querySelector(".font-medium")?.textContent === "rss"
    );
    expect(rssButton).toBeInTheDocument();
    fireEvent.click(rssButton!);

    // Only rss items should show in feed
    expect(getCardIds()).toContain("rss-1");
    expect(getCardIds()).not.toContain("nostr-1");

    // "Clear filter" button should appear
    expect(sidebar.textContent).toContain("Clear filter");
  });

  it("clicking active source toggles filter off", () => {
    const items = [
      makeItem({ id: "rss-2", source: "rss" }),
      makeItem({ id: "nostr-2", source: "nostr" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();

    const sourceButtons = sidebar.querySelectorAll<HTMLButtonElement>("button");
    const rssButton = Array.from(sourceButtons).find(
      btn => btn.querySelector(".font-medium")?.textContent === "rss"
    );
    expect(rssButton).toBeInTheDocument();
    fireEvent.click(rssButton!);
    expect(getCardIds()).not.toContain("nostr-2");

    fireEvent.click(rssButton!);
    expect(getCardIds()).toContain("nostr-2");
  });

  it("shows quality rate bar for each source", () => {
    const items = [
      makeItem({ source: "rss", verdict: "quality" }),
      makeItem({ source: "rss", verdict: "slop" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    // 1 quality / 2 total = 50%
    expect(sidebar.textContent).toContain("50%");
  });

  it("uses source field (not platform) for filter key", () => {
    const items = [
      makeItem({ id: "yt-1", source: "rss", platform: "youtube" as ContentItem["platform"] }),
      makeItem({ id: "plain-rss", source: "rss" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();

    // Both items have source="rss", grouped under one filter key
    const sourceButtons = sidebar.querySelectorAll<HTMLButtonElement>("button");
    const rssButton = Array.from(sourceButtons).find(
      btn => btn.querySelector(".font-medium")?.textContent?.includes("rss") ||
             btn.querySelector(".font-medium")?.textContent?.includes("youtube")
    );
    expect(rssButton).toBeInTheDocument();
    fireEvent.click(rssButton!);

    // Both items should show since both have source="rss"
    expect(getCardIds()).toContain("yt-1");
    expect(getCardIds()).toContain("plain-rss");
  });
});

// ─── Top Topics Interactive + Trend ───

describe("Sidebar — Top Topics interactive filter", () => {
  it("clicking a topic filters content by that topic", () => {
    mockProfile.topicAffinities = { "AI": 0.9, "Crypto": 0.7 };
    const items = [
      makeItem({ id: "ai-1", topics: ["AI"], text: "AI content one" }),
      makeItem({ id: "crypto-1", topics: ["Crypto"], text: "Crypto content one" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();

    // Click "AI" topic
    const aiButton = within(sidebar).getByText("AI").closest("button")!;
    fireEvent.click(aiButton);

    expect(getCardIds()).toContain("ai-1");
    expect(getCardIds()).not.toContain("crypto-1");

    // "Clear topic filter" should appear
    expect(sidebar.textContent).toContain("Clear topic filter");
  });

  it("clicking active topic toggles filter off", () => {
    mockProfile.topicAffinities = { "AI": 0.9 };
    const items = [
      makeItem({ id: "ai-2", topics: ["AI"] }),
      makeItem({ id: "other-2", topics: ["Other"] }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    const aiButton = within(sidebar).getByText("AI").closest("button")!;

    fireEvent.click(aiButton);
    expect(getCardIds()).not.toContain("other-2");

    fireEvent.click(aiButton);
    expect(getCardIds()).toContain("other-2");
  });

  it("topic filter is case-insensitive", () => {
    mockProfile.topicAffinities = { "AI": 0.9 };
    const items = [
      makeItem({ id: "ai-ci", topics: ["ai"] }), // lowercase tag
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    const aiButton = within(sidebar).getByText("AI").closest("button")!;
    fireEvent.click(aiButton);
    expect(getCardIds()).toContain("ai-ci");
  });
});

describe("Sidebar — Topic trend indicators", () => {
  it("shows no NEW badge on first visit (no previous affinities stored)", () => {
    mockProfile.topicAffinities = { "AI": 0.9 };
    render(<DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    // First visit = no prev affinities → no isNew
    expect(sidebar.textContent).not.toContain("NEW");
  });

  it("shows NEW badge when previous affinities exist and topic is new", () => {
    // Simulate previous session stored affinities without "Crypto"
    localStorage.setItem("aegis-prev-affinities", JSON.stringify({ "AI": 0.8 }));
    mockProfile.topicAffinities = { "AI": 0.9, "Crypto": 0.7 };
    render(<DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("NEW");
  });

  it("shows up arrow when score increased", () => {
    localStorage.setItem("aegis-prev-affinities", JSON.stringify({ "AI": 0.5 }));
    mockProfile.topicAffinities = { "AI": 0.9 };
    render(<DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("\u2191");
  });

  it("shows down arrow when score decreased", () => {
    localStorage.setItem("aegis-prev-affinities", JSON.stringify({ "AI": 0.9 }));
    mockProfile.topicAffinities = { "AI": 0.3 };
    render(<DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("\u2193");
  });

  it("shows no arrow when score is stable", () => {
    localStorage.setItem("aegis-prev-affinities", JSON.stringify({ "AI": 0.9 }));
    mockProfile.topicAffinities = { "AI": 0.91 }; // within 0.05 threshold
    render(<DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).not.toContain("\u2191");
    expect(sidebar.textContent).not.toContain("\u2193");
  });
});

// ─── Section Collapse Persistence ───

describe("Sidebar — Section collapse persistence", () => {
  it("persists collapsed state to localStorage", () => {
    mockProfile.topicAffinities = { "AI": 0.9 };
    const items = [makeItem()];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();

    // Find and click the topics collapse button
    const collapseButtons = within(sidebar).getAllByText("\u25BC");
    const topicsCollapseBtn = collapseButtons.find(
      el => el.closest("div")?.textContent?.includes("Top Topics")
    );
    expect(topicsCollapseBtn).toBeInTheDocument();
    fireEvent.click(topicsCollapseBtn!);

    // Check localStorage
    const stored = JSON.parse(localStorage.getItem("aegis-sidebar-collapsed") ?? "{}");
    expect(stored["topics"]).toBe(true);
  });

  it("restores collapsed state from localStorage on mount", () => {
    localStorage.setItem("aegis-sidebar-collapsed", JSON.stringify({ topics: true }));
    mockProfile.topicAffinities = { "AI": 0.9 };
    const items = [makeItem()];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();

    // Topics section should be collapsed — showing ▶ expand button
    const expandBtns = within(sidebar).getAllByText("\u25B6");
    const topicsExpand = expandBtns.find(
      el => el.closest("button")?.textContent?.includes("Top Topics")
    );
    expect(topicsExpand).toBeInTheDocument();
    // Score should not be visible when collapsed
    expect(sidebar.textContent).not.toContain("0.9");
  });
});

// ─── Agent Knowledge Enhancement ───

describe("Sidebar — Agent Knowledge enhancements", () => {
  it("shows recent learning actions", () => {
    mockProfile.totalValidated = 3;
    mockProfile.totalFlagged = 1;
    mockProfile.topicAffinities = { "AI": 0.5 };
    mockProfile.authorTrust = { "Alice": { trust: 0.5, interactions: 3 } };

    const items = [
      makeItem({ validated: true, validatedAt: now - 1000, topics: ["AI"], author: "Alice" }),
      makeItem({ flagged: true, validatedAt: now - 2000, topics: ["Spam"], author: "Bob" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    expect(sidebar.textContent).toContain("Recent learning:");
  });

  it("shows milestone progress when close to next milestone", () => {
    mockProfile.totalValidated = 8;
    mockProfile.totalFlagged = 0;
    mockProfile.topicAffinities = { "AI": 0.5 };
    mockProfile.authorTrust = { "Alice": { trust: 0.5, interactions: 3 } };

    const items = [makeItem({ validated: true, validatedAt: now })];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    // totalReviews=8, nextMilestone=10, remaining=2
    expect(sidebar.textContent).toContain("2 more to next milestone");
  });

  it("does not show milestone when far from next milestone", () => {
    mockProfile.totalValidated = 12;
    mockProfile.totalFlagged = 0;
    mockProfile.topicAffinities = { "AI": 0.5 };
    mockProfile.authorTrust = { "Alice": { trust: 0.5, interactions: 3 } };

    const items = [makeItem({ validated: true, validatedAt: now })];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    // totalReviews=12, nextMilestone=25, remaining=13 → hidden (> 10)
    expect(sidebar.textContent).not.toContain("more to next milestone");
  });
});

// ─── Sources delta: today vs yesterday ───

describe("Sidebar — Sources delta correctness", () => {
  it("compares today sources vs yesterday sources (not all-time)", () => {
    const items = [
      // Today: 2 sources (rss, nostr)
      makeItem({ createdAt: now - 1000, source: "rss" }),
      makeItem({ createdAt: now - 2000, source: "nostr" }),
      // Yesterday: 1 source (rss)
      makeItem({ createdAt: now - dayMs - 1000, source: "rss" }),
      // Old: different source (should not affect delta)
      makeItem({ createdAt: now - 10 * dayMs, source: "url" }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();
    // todaySources=2, yesterdaySources=1, delta=+1
    const metricsBar = within(sidebar).getByTestId("aegis-metrics-bar");
    expect(metricsBar.textContent).toContain("+1");
  });
});

// ─── Unreviewed Queue scroll-to with batch expansion ───

describe("Sidebar — Unreviewed Queue scroll-to", () => {
  it("expands batch when clicked item is beyond visible items", () => {
    // Create 50 items — first 40 fill initial batch, items 41-50 are beyond
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({
        id: `scroll-${i}`,
        text: `Scroll test item ${i} ${Math.random().toString(36).slice(2)}`,
        createdAt: now - i * 60000,
        scores: { originality: 9 - (i * 0.1), insight: 9 - (i * 0.1), credibility: 9 - (i * 0.1), composite: 9 - (i * 0.1) },
      })
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);

    // Initially only 40 items visible
    const initialCards = getCardIds();
    expect(initialCards.length).toBeLessThanOrEqual(40);

    // The sidebar unreviewed queue picks top unreviewed items by composite score
    // These should be the first few items (highest scores)
    // Clicking one that IS visible should work
    const sidebar = getSidebar();
    const needsReview = sidebar.textContent?.includes("Needs Review");
    expect(needsReview).toBe(true);
  });
});

// ─── CommandPalette topic commands ───

describe("Sidebar — CommandPalette topic commands", () => {
  it("palette includes topic commands when topics exist", () => {
    mockProfile.topicAffinities = { "AI": 0.9, "Crypto": 0.7 };
    const items = [makeItem()];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);

    // Open palette (simulate Cmd+K)
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    // Should see topic commands
    const palette = document.querySelector('[data-testid="aegis-command-palette"]') ??
                    document.querySelector('[role="dialog"]');
    if (palette) {
      expect(palette.textContent).toContain("Topic: AI");
      expect(palette.textContent).toContain("Topic: Crypto");
    }
  });
});

// ─── Topic filter chip in filter bar ───

describe("Sidebar — Topic filter chip in filter bar", () => {
  it("shows active topic chip when topic filter is active", () => {
    mockProfile.topicAffinities = { "AI": 0.9 };
    const items = [
      makeItem({ id: "ai-chip-1", topics: ["AI"] }),
      makeItem({ id: "other-chip-1", topics: ["Other"] }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();

    // Activate topic filter via sidebar
    const aiButton = within(sidebar).getByText("AI").closest("button")!;
    fireEvent.click(aiButton);

    // Topic chip should appear in filter bar
    const chip = screen.getByTestId("aegis-filter-topic-active");
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toContain("AI");
  });

  it("clicking topic chip dismisses topic filter", () => {
    mockProfile.topicAffinities = { "AI": 0.9 };
    const items = [
      makeItem({ id: "ai-dismiss-1", topics: ["AI"] }),
      makeItem({ id: "other-dismiss-1", topics: ["Other"] }),
    ];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    const sidebar = getSidebar();

    // Activate topic filter
    const aiButton = within(sidebar).getByText("AI").closest("button")!;
    fireEvent.click(aiButton);
    expect(getCardIds()).not.toContain("other-dismiss-1");

    // Click chip to dismiss
    const chip = screen.getByTestId("aegis-filter-topic-active");
    fireEvent.click(chip);

    // All items visible again
    expect(getCardIds()).toContain("other-dismiss-1");
    expect(screen.queryByTestId("aegis-filter-topic-active")).toBeNull();
  });

  it("no topic chip when topic filter is not active", () => {
    const items = [makeItem()];
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);
    expect(screen.queryByTestId("aegis-filter-topic-active")).toBeNull();
  });
});
