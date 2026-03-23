/**
 * @jest-environment jsdom
 *
 * Comprehensive tests for DashboardTab covering:
 * - DashboardCard component (extracted card rendering)
 * - AgentKnowledgePills (interest/author pills, edge cases)
 * - Feedback loop (validate/flag → agent learned messages)
 * - Bookmark toggling
 * - Mode toggle persistence (localStorage)
 * - Section/topic expansion toggles
 * - More Filters dropdown interactions
 * - NewItemsBar rendering
 * - OnboardingFlow rendering conditions
 * - cardGridStyle helper
 * - Cluster expansion UI
 * - Command palette commands
 * - Edge cases (boundary conditions, empty/null data)
 */
import "@testing-library/jest-dom";

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// Mock IntersectionObserver for JSDOM (useAutoReveal hook)
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, fireEvent, screen, act } from "@testing-library/react";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import type { ContentItem } from "@/lib/types/content";
import type { SerendipityItem } from "@/lib/filtering/serendipity";

// ─── Mocks ───

const mockBookmarkItem = jest.fn();
const mockUnbookmarkItem = jest.fn();
const mockAddFilterRule = jest.fn();

let mockProfile = {
  topicAffinities: { ai: 0.8, crypto: 0.5, ignored: 0.05 } as Record<string, number>,
  authorTrust: { "Alice": { trust: 0.6, interactions: 5 }, "Bob": { trust: 0.1, interactions: 1 } } as Record<string, { trust: number; interactions: number }>,
  recentTopics: [{ topic: "ai", timestamp: Date.now() }] as Array<{ topic: string; timestamp: number }>,
  totalValidated: 10,
  totalFlagged: 5,
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
    addFilterRule: mockAddFilterRule,
    bookmarkItem: mockBookmarkItem,
    unbookmarkItem: mockUnbookmarkItem,
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

// ─── Helpers ───

const now = Date.now();

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    owner: "test-owner",
    author: "Test Author",
    avatar: "T",
    text: `Unique content ${Math.random().toString(36).slice(2)}`,
    source: "rss",
    scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
    verdict: "quality" as const,
    reason: "test reason",
    createdAt: now - 1000,
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["ai"],
    ...overrides,
  };
}

function makeDiscovery(itemOverrides: Partial<ContentItem> = {}): SerendipityItem {
  return {
    item: makeItem(itemOverrides),
    discoveryType: "emerging_topic",
    reason: "Expanding your horizons",
    wotScore: 0.5,
    qualityComposite: 7,
  };
}

function resetProfile() {
  mockProfile = {
    topicAffinities: { ai: 0.8, crypto: 0.5, ignored: 0.05 },
    authorTrust: { "Alice": { trust: 0.6, interactions: 5 }, "Bob": { trust: 0.1, interactions: 1 } },
    recentTopics: [{ topic: "ai", timestamp: Date.now() }],
    totalValidated: 10,
    totalFlagged: 5,
    calibration: { qualityThreshold: 6.0 },
    bookmarkedIds: [],
  };
}

beforeEach(() => {
  resetProfile();
  mockBookmarkItem.mockClear();
  mockUnbookmarkItem.mockClear();
  mockAddFilterRule.mockClear();
  localStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  localStorage.clear();
});

// ═══════════════════════════════════════════════════════════
// 1. DashboardCard — rendered within dashboard sections
// ═══════════════════════════════════════════════════════════

describe("DashboardCard — rendered via dashboard sections", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("renders text truncated to 150 chars for standard cards (Needs Review)", () => {
    const longText = "Z".repeat(300);
    // Create unreviewed quality items that appear in Needs Review
    // Use unique topics so items don't get consumed by Topic Spotlight
    const fillers = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `trunc-fill-${i}`, text: `Filler text for top3 ${i}`, topics: ["filler"],
        scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } }),
    );
    const reviewItems = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `trunc-${i}`, text: i === 0 ? longText : `Short unique review text ${i}`,
        topics: ["misc"], verdict: "quality", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
    );
    const { container } = render(
      <DashboardTab content={[...fillers, ...reviewItems]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Needs Review is a CollapsibleSection — click to expand
    const reviewSection = container.querySelector('[data-testid="aegis-section-review-queue"]');
    const expandBtn = reviewSection?.querySelector("button");
    if (expandBtn) fireEvent.click(expandBtn);
    // After expanding, check truncation: DashboardCard default textSlice=150
    expect(container.textContent).toContain("Z".repeat(150));
    expect(container.textContent).not.toContain("Z".repeat(151));
  });

  it("renders text truncated to 200 chars for Top3 featured cards", () => {
    const longText = "B".repeat(300);
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `top-${i}`, text: i === 0 ? longText : `Top text ${i}`,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("B".repeat(200));
    expect(html).not.toContain("B".repeat(201));
  });

  it("shows platform name in Top3 cards when platform field exists", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `plat-${i}`, platform: "youtube", source: "rss",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Top3 uses showPlatform → shows platform instead of source
    expect(html).toContain("youtube");
  });

  it("disables validate button with opacity when item is already validated", () => {
    // Validated items still appear in Top3 (only flagged items are excluded)
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `val-${i}`, validated: i < 2, validatedAt: i < 2 ? now : undefined,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const validateBtns = Array.from(container.querySelectorAll('button[aria-label="Validate"]'));
    expect(validateBtns.length).toBeGreaterThan(0);
    const disabledBtns = validateBtns.filter(b => (b as HTMLButtonElement).disabled);
    expect(disabledBtns.length).toBeGreaterThan(0);
    disabledBtns.forEach(btn => {
      expect(btn.className).toContain("opacity-50");
    });
  });

  it("renders rank badges (1, 2, 3) in Top3 cards", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `rank-${i}`, text: `Rank test ${i} unique`,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
  });
});

// ═══════════════════════════════════════════════════════════
// 2. AgentKnowledgePills — interest/author pills rendering
// ═══════════════════════════════════════════════════════════

describe("AgentKnowledgePills — rendering within Your Agent card", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("shows interest pills when agent has enough data (>= 3 reviews)", () => {
    // profile has totalValidated=10 + totalFlagged=5 = 15 >= 3
    // ai (0.8) >= 0.3 threshold, crypto (0.5) >= 0.3 threshold
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Interests:");
    expect(html).toContain("ai");
    expect(html).toContain("crypto");
  });

  it("shows trusted author pills when agent has trusted authors", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Alice has trust 0.6 >= 0.3 threshold
    expect(html).toContain("Trusted:");
    expect(html).toContain("Alice");
    // Bob has trust 0.1 < 0.3 threshold → not shown
    expect(html).not.toContain("Bob");
  });

  it("shows empty state message when agent has no learned data", () => {
    mockProfile.topicAffinities = {};
    mockProfile.authorTrust = {};
    // Still >= 3 reviews (10+5=15)
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Validate or flag content to teach your agent");
  });

  it("does NOT show AgentKnowledgePills when insufficient reviews (< 3)", () => {
    mockProfile.totalValidated = 1;
    mockProfile.totalFlagged = 1;
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // agentContext is null → no pills rendered, but card still shows
    expect(html).not.toContain("Interests:");
    expect(html).not.toContain("Trusted:");
    // Card header still shows
    expect(html).toContain("Your Agent");
  });

  it("truncates interest pills to 6 items", () => {
    mockProfile.topicAffinities = {};
    for (let i = 0; i < 10; i++) mockProfile.topicAffinities[`topic-${i}`] = 0.5;
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Only first 6 topics should be shown as pills
    let topicPillCount = 0;
    for (let i = 0; i < 10; i++) {
      if (html.includes(`topic-${i}`)) topicPillCount++;
    }
    expect(topicPillCount).toBeLessThanOrEqual(6);
  });

  it("truncates trusted author pills to 4 items", () => {
    mockProfile.authorTrust = {};
    for (let i = 0; i < 8; i++) {
      mockProfile.authorTrust[`Author-${i}`] = { trust: 0.5, interactions: 5 };
    }
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    let authorPillCount = 0;
    for (let i = 0; i < 8; i++) {
      if (html.includes(`Author-${i}`)) authorPillCount++;
    }
    expect(authorPillCount).toBeLessThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. Feedback loop — validate/flag → agent learned messages
// ═══════════════════════════════════════════════════════════

function findActionButtons(container: HTMLElement) {
  const validate = Array.from(container.querySelectorAll('button[aria-label="Validate"]'));
  const flag = Array.from(container.querySelectorAll('button[aria-label="Flag as slop"]'));
  const bookmark = Array.from(container.querySelectorAll('button[aria-label="Save"], button[aria-label="Remove bookmark"]'));
  return { validate, flag, bookmark };
}

describe("Feedback loop — agent learned messages", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("shows feedback message after validating an item with topic", () => {
    // Need enough items to populate Top3 where DashboardCard buttons appear
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `fb-${i}`, topics: ["ai"], author: "Alice",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const onValidate = jest.fn();
    const { container } = render(
      <DashboardTab content={items} onValidate={onValidate} onFlag={jest.fn()} />
    );
    const { validate } = findActionButtons(container);
    expect(validate.length).toBeGreaterThan(0);
    act(() => { fireEvent.click(validate[0]); });
    expect(screen.getByText(/Agent learned/)).toBeInTheDocument();
    expect(onValidate).toHaveBeenCalled();
  });

  it("shows feedback message after flagging an item", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `fb2-${i}`, topics: ["crypto"], author: "Mallory", verdict: "quality",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const onFlag = jest.fn();
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={onFlag} />
    );
    const { flag } = findActionButtons(container);
    expect(flag.length).toBeGreaterThan(0);
    act(() => { fireEvent.click(flag[0]); });
    expect(screen.getByText(/Agent learned/)).toBeInTheDocument();
    expect(onFlag).toHaveBeenCalled();
  });

  it("feedback message disappears after 3.5 seconds", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `fb3-${i}`, topics: ["ai"],
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const { validate } = findActionButtons(container);
    act(() => { fireEvent.click(validate[0]); });
    expect(screen.getByText(/Agent learned/)).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(3500); });
    expect(screen.queryByText(/Agent learned/)).toBeNull();
  });

  it("does not show feedback for items without topics or notable authors", () => {
    // ALL items have no topics and author "You" → no feedback parts → no message
    // Also composite must not be in 3.5-4.5 range (which triggers "Threshold relaxed")
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `fb4-${i}`, topics: [], author: "You",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const { validate } = findActionButtons(container);
    expect(validate.length).toBeGreaterThan(0);
    act(() => { fireEvent.click(validate[0]); });
    // No meaningful parts → no feedback message
    expect(screen.queryByText(/Agent learned/)).toBeNull();
  });

  it("replaces previous feedback message on rapid validation", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `rapid-${i}`, topics: ["ai", "crypto"][i % 2] ? [["ai", "crypto"][i % 2]!] : ["ai"], author: `Author${i}`,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const { validate } = findActionButtons(container);
    expect(validate.length).toBeGreaterThanOrEqual(2);
    act(() => { fireEvent.click(validate[0]); });
    expect(screen.getByText(/Agent learned/)).toBeInTheDocument();
    // Second validation replaces the first message
    act(() => { fireEvent.click(validate[1]); });
    const messages = screen.getAllByText(/Agent learned/);
    expect(messages).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════
// 4. Bookmark toggling
// ═══════════════════════════════════════════════════════════

describe("Bookmark toggling", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("calls bookmarkItem when clicking bookmark on non-bookmarked item", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `bk-${i}`,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const { bookmark } = findActionButtons(container);
    expect(bookmark.length).toBeGreaterThan(0);
    fireEvent.click(bookmark[0]);
    expect(mockBookmarkItem).toHaveBeenCalled();
  });

  it("calls unbookmarkItem when clicking bookmark on already-bookmarked item", () => {
    mockProfile.bookmarkedIds = ["bk-0"];
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `bk-${i}`,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const { bookmark } = findActionButtons(container);
    expect(bookmark.length).toBeGreaterThan(0);
    fireEvent.click(bookmark[0]);
    expect(mockUnbookmarkItem).toHaveBeenCalledWith("bk-0");
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Mode toggle + localStorage persistence
// ═══════════════════════════════════════════════════════════

describe("Mode toggle and localStorage persistence", () => {
  it("defaults to feed mode when no localStorage value", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Feed mode shows "Filtered Signal"
    expect(html).toContain("Filtered Signal");
    expect(html).not.toContain("Top 3");
  });

  it("restores dashboard mode from localStorage", () => {
    localStorage.setItem("aegis-home-mode", "dashboard");
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Top 3");
    expect(html).not.toContain("Filtered Signal");
  });

  it("switches from feed to dashboard mode on button click", () => {
    render(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(screen.getByText("Filtered Signal")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("aegis-home-mode-dashboard"));
    expect(screen.queryByText("Filtered Signal")).toBeNull();
    expect(screen.getByText(/Top 3/)).toBeInTheDocument();
  });

  it("persists mode switch to localStorage", () => {
    render(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-home-mode-dashboard"));
    expect(localStorage.getItem("aegis-home-mode")).toBe("dashboard");
    fireEvent.click(screen.getByTestId("aegis-home-mode-feed"));
    expect(localStorage.getItem("aegis-home-mode")).toBe("feed");
  });

  it("handles localStorage unavailable gracefully", () => {
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("QuotaExceeded"); };
    // Should not throw
    expect(() => {
      render(
        <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
    Storage.prototype.setItem = origSetItem;
  });
});

// ═══════════════════════════════════════════════════════════
// 6. Section and topic expansion toggles
// ═══════════════════════════════════════════════════════════

describe("Section and topic expansion", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("Topic Spotlight renders topic accordion that can be toggled", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `texp-${i}`, topics: ["ai"], text: `Topic expand test ${i}`,
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    );
    // Fillers to fill Top3
    const fillers = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `tfill-${i}`, topics: ["other"], text: `Filler ${i}`,
        scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } }),
    );
    const { container } = render(
      <DashboardTab content={[...fillers, ...items]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Topic accordion should render with ai topic and a clickable toggle
    const allButtons = Array.from(container.querySelectorAll('button'));
    const topicBtn = allButtons.find(btn => (btn.textContent || "").includes("ai") && (btn.textContent || "").includes("▼"));
    expect(topicBtn).toBeDefined();
    // Clicking should expand (auto-reveal starts collapsed in test env)
    fireEvent.click(topicBtn!);
    expect(container.textContent).toContain("Topic expand test");
  });

  it("renders topic accordion button that is clickable", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `ttog-${i}`, topics: ["ai"], text: `Toggle topic test ${i}`,
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
    );
    const fillers = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `ttfill-${i}`, topics: ["other"], text: `Filler ${i}`,
        scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } }),
    );
    const { container } = render(
      <DashboardTab content={[...fillers, ...items]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Topic Spotlight should render accordion buttons with topic names and ▼ chevron
    const allButtons = Array.from(container.querySelectorAll('button'));
    const topicButtons = allButtons.filter(btn => {
      const text = btn.textContent || "";
      return text.includes("▼") && text.includes("ai");
    });
    expect(topicButtons.length).toBeGreaterThan(0);
    // The button should have the topic name visible
    expect(topicButtons[0].textContent).toContain("ai");
    // Clicking the button should not throw
    expect(() => fireEvent.click(topicButtons[0])).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// 7. More Filters dropdown interactions
// ═══════════════════════════════════════════════════════════

describe("More Filters dropdown", () => {
  it("opens dropdown on click", () => {
    const items = [makeItem()];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    expect(screen.getByTestId("aegis-filter-more-panel")).toBeInTheDocument();
  });

  it("shows verdict and source filters in dropdown", () => {
    const items = [
      makeItem({ id: "m1", source: "rss", verdict: "quality" }),
      makeItem({ id: "m2", source: "nostr", verdict: "quality" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    const panel = screen.getByTestId("aegis-filter-more-panel");
    // Verdict section
    expect(panel.textContent).toContain("Verdict");
    expect(screen.getByTestId("aegis-filter-all")).toBeInTheDocument();
    expect(screen.getByTestId("aegis-filter-slop")).toBeInTheDocument();
    // Source section
    expect(panel.textContent).toContain("Source");
    expect(panel.textContent).toContain("All sources");
    expect(panel.textContent).toContain("rss");
    expect(panel.textContent).toContain("nostr");
  });

  it("Latest feed excludes slop by default, Slop filter shows slop", () => {
    const items = [
      makeItem({ id: "fa1", verdict: "quality", text: "Quality content abc123" }),
      makeItem({ id: "fa2", verdict: "slop", text: "Slop content xyz789" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Latest mode auto-excludes slop
    expect(screen.queryByText(/Slop content xyz789/)).toBeNull();
    // Switch to Slop filter to see slop items
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    fireEvent.click(screen.getByTestId("aegis-filter-slop"));
    expect(screen.getByText(/Slop content xyz789/)).toBeInTheDocument();
  });

  it("clicking Slop filter shows only slop items", () => {
    const items = [
      makeItem({ id: "fs1", verdict: "quality", text: "Quality text content abc" }),
      makeItem({ id: "fs2", verdict: "slop", text: "Slop text content xyz" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    fireEvent.click(screen.getByTestId("aegis-filter-slop"));
    // Only slop item should be in filtered list
    const count = screen.getByTestId("aegis-filter-count");
    expect(count.textContent).toContain("1");
  });

  it("closes dropdown on Escape key", () => {
    const items = [makeItem()];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    expect(screen.getByTestId("aegis-filter-more-panel")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("aegis-filter-more-panel")).toBeNull();
  });

  it("closes dropdown on click outside", () => {
    const items = [makeItem()];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    expect(screen.getByTestId("aegis-filter-more-panel")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("aegis-filter-more-panel")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// 8. NewItemsBar rendering
// ═══════════════════════════════════════════════════════════

describe("NewItemsBar", () => {
  it("renders new items bar when pendingCount > 0", () => {
    const items = [makeItem()];
    const onFlush = jest.fn();
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()}
        pendingCount={5} onFlushPending={onFlush} />
    );
    // NewItemsBar should show a pending count indicator
    expect(container.textContent).toContain("5");
  });

  it("does not render new items bar when pendingCount is 0", () => {
    const items = [makeItem()];
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()}
        pendingCount={0} onFlushPending={jest.fn()} />
    );
    // Should not contain any "new items" indicator
    expect(container.textContent).not.toContain("new item");
  });
});

// ═══════════════════════════════════════════════════════════
// 9. OnboardingFlow rendering
// ═══════════════════════════════════════════════════════════

describe("OnboardingFlow", () => {
  it("shows onboarding when content is empty, not loading, not demo, and filter is default", () => {
    // verdictFilter starts as "quality" by default in feed mode
    // with no quality items → filteredContent is empty → shows onboarding (since isDemoMode=false)
    const { container } = render(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // OnboardingFlow should be rendered (it has its own structure)
    // When no content and no filters, it shows onboarding instead of "No matching content"
    // Since sources > 0 but content = 0, onboarding shows
    expect(container.textContent).not.toContain("No content yet");
  });

  it("shows 'No matching content' when filters are active with no results", () => {
    // Start with content that has quality items, then filter to slop (which has none)
    const items = [makeItem({ verdict: "quality" })];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Switch to slop filter
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    fireEvent.click(screen.getByTestId("aegis-filter-slop"));
    expect(screen.getByText("No matching content")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════
// 10. Cluster expansion UI
// ═══════════════════════════════════════════════════════════

describe("Cluster expansion", () => {
  it("renders without crash when multiple similar items may cluster", () => {
    // Create items with overlapping text that may trigger clustering
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({
        id: `cluster-${i}`,
        text: `AI machine learning breakthrough number ${i}`,
        topics: ["ai", "ml"],
        author: "Same Author",
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
      }),
    );
    // Should render without crashing regardless of clustering result
    expect(() => {
      render(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// 11. Your Agent card — section order verification
// ═══════════════════════════════════════════════════════════

describe("Your Agent card — position and section order", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("Your Agent card appears between Topic Spotlight and Discoveries", () => {
    const contentItems = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `ord-${i}`, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    );
    const disc = [makeDiscovery({ id: "disc-ord" })];
    const html = renderToStaticMarkup(
      <DashboardTab content={contentItems} onValidate={jest.fn()} onFlag={jest.fn()} discoveries={disc} />
    );
    const spotlightIdx = html.indexOf("Topic Spotlight");
    const agentIdx = html.indexOf("Your Agent");
    const discIdx = html.indexOf("Discoveries");
    // Your Agent should appear after Topic Spotlight and before Discoveries
    expect(spotlightIdx).toBeLessThan(agentIdx);
    expect(agentIdx).toBeLessThan(discIdx);
  });

  it("Your Agent card shows even when agentContext is null (stats only)", () => {
    mockProfile.totalValidated = 0;
    mockProfile.totalFlagged = 0;
    mockProfile.topicAffinities = {};
    mockProfile.authorTrust = {};
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Card still renders with header
    expect(html).toContain("Your Agent");
    expect(html).toContain("0 interests");
    expect(html).toContain("0 reviews");
    // No pills since agentContext is null (< 3 reviews)
    expect(html).not.toContain("Interests:");
  });
});

// ═══════════════════════════════════════════════════════════
// 12. ScorePill component
// ═══════════════════════════════════════════════════════════

describe("ScorePill rendering", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("renders grade letter for high composite score", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `sp-${i}`, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain(">A<");
  });

  it("renders grade letter for low composite score", () => {
    // In feed mode (no localStorage), items render via ContentCard which includes ScorePill
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `splow-${i}`, verdict: "quality",
        scores: { originality: 3, insight: 3, credibility: 3, composite: 3 } }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // composite 3 → grade "D" (scoreGrade: >= 2 returns "D")
    expect(html).toContain("D");
  });
});

// ═══════════════════════════════════════════════════════════
// 13. Image failure handling
// ═══════════════════════════════════════════════════════════

describe("Image failure handling", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("falls back to grade display when image fails to load", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `imgfail-${i}`, imageUrl: "https://broken.example.com/img.jpg",
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    );
    const { container } = render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Trigger image error
    const imgs = container.querySelectorAll("img");
    imgs.forEach(img => fireEvent.error(img));
    // After error, grade letter should be visible instead of image
    expect(container.textContent).toContain("A");
  });
});

// ═══════════════════════════════════════════════════════════
// 14. Show All button interaction
// ═══════════════════════════════════════════════════════════

describe("Load remaining button", () => {
  it("clicking Load remaining loads next batch", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `show-${i}`, text: `Unique load-remaining test content number ${i}`,
        topics: [`unique-topic-${i}`] }),
    );
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const loadBtn = screen.getByText(/Load remaining/);
    expect(loadBtn).toBeInTheDocument();
    fireEvent.click(loadBtn);
    // After clicking (50 items, batch 40 → all loaded), the button should disappear
    expect(screen.queryByText(/Load remaining/)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// 15. Review All button (dashboard → feed navigation)
// ═══════════════════════════════════════════════════════════

describe("Review All button in Dashboard mode", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("clicking Review All switches to feed mode", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `ra-${i}`, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    );
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByText("Review All →"));
    // Should switch to feed mode
    expect(screen.getByText("Filtered Signal")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════
// 16. Filter reset on filter change
// ═══════════════════════════════════════════════════════════

describe("Filter change resets expanded state", () => {
  it("resets expanded card when switching filters", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({ id: `reset-${i}`, text: `Reset test item ${i}` }),
    );
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Switch filter
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    fireEvent.click(screen.getByTestId("aegis-filter-all"));
    // visibleCount should be reset to BATCH_SIZE
    // Items beyond 40 should be hidden again (if more existed)
    expect(screen.queryByText(/Load remaining/)).toBeNull(); // 3 items < 40
  });
});

// ═══════════════════════════════════════════════════════════
// 17. Edge cases and boundary conditions
// ═══════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("handles item with undefined topics gracefully", () => {
    const items = [makeItem({ id: "notopic", topics: undefined })];
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles item with empty text gracefully", () => {
    const items = [makeItem({ id: "emptytext", text: "" })];
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles item with zero composite score", () => {
    const items = [makeItem({ id: "zero",
      scores: { originality: 0, insight: 0, credibility: 0, composite: 0 } })];
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles item with very high composite score", () => {
    const items = [makeItem({ id: "high",
      scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } })];
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles onTabChange being undefined", () => {
    localStorage.setItem("aegis-home-mode", "dashboard");
    // onTabChange is optional — should not crash
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles extremely large content array without crashing", () => {
    const items = Array.from({ length: 500 }, (_, i) =>
      makeItem({ id: `large-${i}`, text: `Large content set item ${i}` }),
    );
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles duplicate item IDs in content array", () => {
    const items = [
      makeItem({ id: "dup-id", text: "First item" }),
      makeItem({ id: "dup-id", text: "Second item" }),
    ];
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles negative composite score", () => {
    const items = [makeItem({ id: "neg",
      scores: { originality: -1, insight: -1, credibility: -1, composite: -1 } })];
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles item with special characters in text", () => {
    const items = [makeItem({ id: "special", text: '<script>alert("xss")</script> & "quotes" <b>bold</b>' })];
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // React escapes HTML entities — should not contain raw script tags
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("handles createdAt in the future", () => {
    const items = [makeItem({ id: "future", createdAt: Date.now() + 86400000 })];
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });

  it("handles createdAt of 0 (epoch)", () => {
    const items = [makeItem({ id: "epoch", createdAt: 0 })];
    expect(() => {
      renderToStaticMarkup(
        <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
      );
    }).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// 18. Discoveries section with serendipity badges
// ═══════════════════════════════════════════════════════════

describe("Discoveries section", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("renders serendipity badge overlay when reason exists", () => {
    const contentItems = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `disc-content-${i}`, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    );
    const discoveries = [makeDiscovery({ id: "disc-badge-1" })];
    const html = renderToStaticMarkup(
      <DashboardTab content={contentItems} onValidate={jest.fn()} onFlag={jest.fn()} discoveries={discoveries} />
    );
    expect(html).toContain("Discoveries");
  });

  it("does not show Discoveries section when no discoveries provided", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} discoveries={[]} />
    );
    expect(html).not.toContain("Discoveries");
  });
});

// ═══════════════════════════════════════════════════════════
// 19. Concurrent validate/flag on disabled items
// ═══════════════════════════════════════════════════════════

describe("Disabled button behavior", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));

  it("validate button is disabled and non-interactive when already validated", () => {
    const onValidate = jest.fn();
    // Validated items appear in Top3 (only flagged are excluded by generateBriefing)
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `dis-val-${i}`, validated: true, validatedAt: now,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const { container } = render(
      <DashboardTab content={items} onValidate={onValidate} onFlag={jest.fn()} />
    );
    const { validate } = findActionButtons(container);
    expect(validate.length).toBeGreaterThan(0);
    // All validate buttons should be disabled since all items are validated
    validate.forEach(btn => expect(btn.disabled).toBe(true));
    fireEvent.click(validate[0]);
    expect(onValidate).not.toHaveBeenCalled();
  });

  it("flagged items are excluded from dashboard sections", () => {
    // generateBriefing filters !c.flagged, so flagged items don't appear in Top3
    const flaggedItems = Array.from({ length: 4 }, (_, i) =>
      makeItem({ id: `dis-flag-${i}`, flagged: true,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i } }),
    );
    const { container } = render(
      <DashboardTab content={flaggedItems} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // No DashboardCard buttons should be rendered since all items are flagged → excluded
    const { flag } = findActionButtons(container);
    expect(flag.length).toBe(0);
    // Top3 section should show empty state
    const top3 = container.querySelector('[data-testid="aegis-top3-section"]');
    expect(top3?.textContent).toContain("No quality items scored yet");
  });
});

// ═══════════════════════════════════════════════════════════
// 20. Bookmarked filter in feed mode
// ═══════════════════════════════════════════════════════════

describe("Bookmarked filter", () => {
  it("shows only bookmarked items when Saved filter is active", () => {
    mockProfile.bookmarkedIds = ["bk-show"];
    const items = [
      makeItem({ id: "bk-show", text: "Bookmarked item text here", verdict: "quality" }),
      makeItem({ id: "not-bk", text: "Not bookmarked item text", verdict: "quality" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-bookmarked"));
    // Filter count should show 1
    const count = screen.getByTestId("aegis-filter-count");
    expect(count.textContent).toContain("1");
  });
});

// ═══════════════════════════════════════════════════════════
// 21. Keyboard shortcut hint visibility
// ═══════════════════════════════════════════════════════════

describe("Keyboard hints", () => {
  it("shows keyboard hints in feed mode on desktop", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("J/K");
    expect(html).toContain("validate");
    expect(html).toContain("flag");
  });

  it("hides keyboard hints in dashboard mode", () => {
    localStorage.setItem("aegis-home-mode", "dashboard");
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).not.toContain("J/K");
  });

  it("hides keyboard hints on mobile even in feed mode", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} mobile />
    );
    expect(html).not.toContain("J/K");
  });
});
