/**
 * @jest-environment jsdom
 *
 * Integration tests for DashboardTab Latest/Ranked sort mode toggle.
 * Tests exercise real rendering paths — ContentCard, filter logic, sort order.
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

beforeEach(() => {
  localStorage.clear();
  mockProfile.bookmarkedIds = [];
});

// ─── Helpers ───

const now = Date.now();
let _seq = 0;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const n = _seq++;
  return {
    id: `sm-${n}`,
    owner: "test",
    author: "Author",
    avatar: "A",
    text: `Content ${n} ${Math.random().toString(36).slice(2)}`,
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

/** Get card IDs in render order via DOM id attributes (id="card-{item.id}") */
function getCardIds(): string[] {
  const cards = document.querySelectorAll('[data-testid="aegis-content-card"]');
  return Array.from(cards).map(el => el.id.replace("card-", ""));
}

// ─── Tests ───

describe("DashboardTab — Sort Mode Toggle", () => {
  it("renders Latest and Ranked toggle buttons", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(screen.getByTestId("aegis-sort-mode-latest")).toBeTruthy();
    expect(screen.getByTestId("aegis-sort-mode-ranked")).toBeTruthy();
  });

  it("Latest is the default active sort mode", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const latestBtn = screen.getByTestId("aegis-sort-mode-latest");
    const rankedBtn = screen.getByTestId("aegis-sort-mode-ranked");
    expect(latestBtn.className).toContain("bg-card");
    expect(rankedBtn.className).not.toContain("bg-card");
  });

  it("clicking Ranked switches active state", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-sort-mode-ranked"));
    expect(screen.getByTestId("aegis-sort-mode-ranked").className).toContain("bg-card");
    expect(screen.getByTestId("aegis-sort-mode-latest").className).not.toContain("bg-card");
  });

  it("sort mode toggle is hidden in Dashboard mode", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-home-mode-dashboard"));
    expect(screen.queryByTestId("aegis-sort-mode-latest")).toBeNull();
    expect(screen.queryByTestId("aegis-sort-mode-ranked")).toBeNull();
  });

  it("persists sort mode to localStorage", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-sort-mode-ranked"));
    expect(localStorage.getItem("aegis-sort-mode")).toBe("ranked");
    fireEvent.click(screen.getByTestId("aegis-sort-mode-latest"));
    expect(localStorage.getItem("aegis-sort-mode")).toBe("latest");
  });
});

describe("DashboardTab — Latest Mode Behavior", () => {
  it("excludes slop items by default in Latest mode", () => {
    const items = [
      makeItem({ id: "q1", text: "Quality item alpha", verdict: "quality" }),
      makeItem({ id: "s1", text: "Slop item beta", verdict: "slop" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(screen.queryByText(/Quality item alpha/)).toBeTruthy();
    expect(screen.queryByText(/Slop item beta/)).toBeNull();
  });

  it("shows items in chronological order (newest first), not by score", () => {
    const items = [
      makeItem({ id: "oldest", text: "Oldest item aaa", createdAt: now - 3000, scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      makeItem({ id: "newest", text: "Newest item bbb", createdAt: now, scores: { originality: 1, insight: 1, credibility: 1, composite: 1 } }),
      makeItem({ id: "middle", text: "Middle item ccc", createdAt: now - 1000, scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const ids = getCardIds();
    expect(ids.indexOf("newest")).toBeLessThan(ids.indexOf("middle"));
    expect(ids.indexOf("middle")).toBeLessThan(ids.indexOf("oldest"));
  });

  it("does not show cluster expand buttons in Latest mode", () => {
    const items = [
      makeItem({ id: "c1", text: "Cluster topic alpha beta gamma", topics: ["ai", "ml"], createdAt: now }),
      makeItem({ id: "c2", text: "Cluster topic alpha beta gamma delta", topics: ["ai", "ml"], createdAt: now - 100 }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const ids = getCardIds();
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
    expect(screen.queryByText(/related/)).toBeNull();
  });

  it("Slop filter in Latest mode shows only slop", () => {
    const items = [
      makeItem({ id: "q1", text: "Quality xxx", verdict: "quality" }),
      makeItem({ id: "s1", text: "Slop yyy", verdict: "slop" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    fireEvent.click(screen.getByTestId("aegis-filter-slop"));
    expect(screen.queryByText(/Quality xxx/)).toBeNull();
    expect(screen.queryByText(/Slop yyy/)).toBeTruthy();
  });

  it("Validated filter in Latest mode shows only validated items with timestamp badge", () => {
    const items = [
      makeItem({ id: "v1", text: "Validated item zzz", validated: true, validatedAt: now }),
      makeItem({ id: "nv1", text: "Not validated www", validated: false }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-validated"));
    expect(screen.queryByText(/Validated item zzz/)).toBeTruthy();
    expect(screen.queryByText(/Not validated www/)).toBeNull();
    // Validated timestamp badge appears (caption + purple + mono + semibold)
    const badges = document.querySelectorAll(".text-caption.text-purple-400.font-mono.font-semibold");
    const badge = Array.from(badges).find(el => el.textContent?.includes("Validated"));
    expect(badge).toBeTruthy();
  });

  it("Bookmarked filter in Latest mode shows only bookmarked items", () => {
    mockProfile.bookmarkedIds = ["bk1"];
    const items = [
      makeItem({ id: "bk1", text: "Bookmarked content ppp" }),
      makeItem({ id: "bk2", text: "Not bookmarked qqq" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-bookmarked"));
    expect(screen.queryByText(/Bookmarked content ppp/)).toBeTruthy();
    expect(screen.queryByText(/Not bookmarked qqq/)).toBeNull();
  });

  it("source filter works in Latest mode", () => {
    const items = [
      makeItem({ id: "sr1", text: "RSS content mmm", source: "rss" }),
      makeItem({ id: "sn1", text: "Nostr content nnn", source: "nostr" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    const panel = screen.getByTestId("aegis-filter-more-panel");
    fireEvent.click(within(panel).getByText("nostr"));
    expect(screen.queryByText(/RSS content mmm/)).toBeNull();
    expect(screen.queryByText(/Nostr content nnn/)).toBeTruthy();
  });
});

describe("DashboardTab — Ranked Mode Behavior", () => {
  it("switching to Ranked mode, All filter shows slop items", () => {
    const items = [
      makeItem({ id: "rq1", text: "Ranked quality rrr", verdict: "quality" }),
      makeItem({ id: "rs1", text: "Ranked slop sss", verdict: "slop" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-sort-mode-ranked"));
    expect(screen.queryByText(/Ranked quality rrr/)).toBeTruthy();
    expect(screen.queryByText(/Ranked slop sss/)).toBeTruthy();
  });

  it("Show all button: item count in Latest, group count in Ranked", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({
        id: `sa-${i}`,
        text: `Expand test item ${i} unique-${Math.random()}`,
        createdAt: now - i * 1000,
        topics: [`topic-unique-${i}`],
      })
    );
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const showAllBtn = screen.getByText(/^Show all/);
    expect(showAllBtn.textContent).toContain("6 items");
    expect(showAllBtn.textContent).not.toContain("groups");

    fireEvent.click(screen.getByTestId("aegis-sort-mode-ranked"));
    const showAllBtn2 = screen.getByText(/^Show all/);
    expect(showAllBtn2.textContent).toContain("groups");
  });
});

describe("DashboardTab — Sort Mode Edge Cases", () => {
  it("all items are slop → Latest shows no cards", () => {
    const items = [
      makeItem({ id: "as1", verdict: "slop", text: "All slop one" }),
      makeItem({ id: "as2", verdict: "slop", text: "All slop two" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(getCardIds()).toHaveLength(0);
  });

  it("switching sort modes back and forth preserves filter state", () => {
    const items = [
      makeItem({ id: "sw1", text: "Switch test quality", verdict: "quality" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    fireEvent.click(screen.getByTestId("aegis-filter-quality"));
    expect(screen.getByTestId("aegis-filter-quality").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("aegis-sort-mode-ranked"));
    fireEvent.click(screen.getByTestId("aegis-sort-mode-latest"));
    expect(screen.getByTestId("aegis-filter-quality").getAttribute("aria-pressed")).toBe("true");
  });

  it("single item renders correctly in Latest mode", () => {
    const items = [makeItem({ id: "single", text: "Single item only" })];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(getCardIds()).toContain("single");
    expect(screen.queryByText(/Show all/)).toBeNull();
  });

  it("exactly 5 items: no Show all button", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `five-${i}`, text: `Five items ${i} ${Math.random()}`, createdAt: now - i * 1000 })
    );
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(screen.queryByText(/Show all/)).toBeNull();
    expect(getCardIds()).toHaveLength(5);
  });

  it("6 items: Show all reveals 6th item", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `six-${i}`, text: `Six items ${i} ${Math.random()}`, createdAt: now - i * 1000 })
    );
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(getCardIds()).toHaveLength(5);
    fireEvent.click(screen.getByText(/Show all/));
    expect(getCardIds()).toHaveLength(6);
  });

  it("moreFiltersActive dot hidden in default state, visible with slop filter", () => {
    render(
      <DashboardTab content={[makeItem()]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const moreBtn = screen.getByTestId("aegis-filter-more");
    expect(moreBtn.querySelector(".bg-cyan-400")).toBeNull();

    fireEvent.click(moreBtn);
    fireEvent.click(screen.getByTestId("aegis-filter-slop"));
    expect(screen.getByTestId("aegis-filter-more").querySelector(".bg-cyan-400")).toBeTruthy();
  });

  it("empty content in Latest mode shows onboarding (no active filter)", () => {
    render(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    const dashboard = screen.getByTestId("aegis-dashboard");
    // Default "all" filter → no active filter → onboarding (not "No matching content")
    expect(dashboard.textContent).not.toContain("No matching content");
  });

  it("restores ranked from localStorage", () => {
    localStorage.setItem("aegis-sort-mode", "ranked");
    const items = [
      makeItem({ id: "lr1", text: "Stored ranked item", verdict: "slop" }),
    ];
    render(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // Ranked mode + all filter → slop visible
    expect(screen.getByTestId("aegis-sort-mode-ranked").className).toContain("bg-card");
    expect(screen.queryByText(/Stored ranked item/)).toBeTruthy();
  });
});
