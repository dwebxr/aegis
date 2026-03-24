/**
 * @jest-environment jsdom
 */
/**
 * BriefingTab — search feature tests.
 * Tests search bar rendering, filtering logic, edge cases,
 * keyboard interaction, mobile toggle, and result display.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

jest.mock("@/components/ui/ContentCard", () => ({
  ContentCard: ({ item }: { item: ContentItem }) => (
    <div data-testid={`card-${item.id}`}>{item.text}</div>
  ),
  YouTubePreview: () => null,
}));

jest.mock("@/components/ui/ShareBriefingModal", () => ({
  ShareBriefingModal: () => null,
}));

jest.mock("@/components/filtering/SerendipityBadge", () => ({
  SerendipityBadge: () => null,
}));

jest.mock("@/contexts/ContentContext", () => ({
  useContent: () => ({ syncBriefing: jest.fn() }),
}));

jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: () => null,
}));

import { BriefingTab } from "@/components/tabs/BriefingTab";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 6)}`,
    owner: "user",
    author: "Alice",
    avatar: "",
    text: "Default text",
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "good",
    createdAt: Date.now(),
    validated: true,
    flagged: false,
    timestamp: new Date().toISOString(),
    topics: ["tech"],
    ...overrides,
  };
}

const profile: UserPreferenceProfile = {
  version: 1,
  principalId: "test",
  topicAffinities: {},
  authorTrust: {},
  calibration: { qualityThreshold: 3 },
  recentTopics: [],
  totalValidated: 5,
  totalFlagged: 2,
  lastUpdated: Date.now(),
};

const noop = () => {};

function renderBriefing(content: ContentItem[], mobile = false) {
  return render(
    <BriefingTab
      content={content}
      profile={profile}
      onValidate={noop}
      onFlag={noop}
      mobile={mobile}
    />,
  );
}

function getSearchInput(): HTMLInputElement {
  return screen.getByLabelText("Search briefing content") as HTMLInputElement;
}

const items = [
  makeItem({ id: "a1", text: "React hooks guide", author: "Alice", topics: ["react", "frontend"], scores: { originality: 9, insight: 8, credibility: 8, composite: 9 } }),
  makeItem({ id: "a2", text: "Rust memory safety", author: "Bob", topics: ["rust", "systems"], scores: { originality: 7, insight: 7, credibility: 7, composite: 7 } }),
  makeItem({ id: "a3", text: "Bitcoin halving analysis", author: "Charlie", topics: ["crypto"], scores: { originality: 5, insight: 5, credibility: 5, composite: 5 } }),
  makeItem({ id: "a4", text: "Deep dive into React Server Components", author: "Diana", topics: ["react", "nextjs"], scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
  makeItem({ id: "a5", text: "Alice in Wonderland review", author: "Eve", topics: ["books"], scores: { originality: 6, insight: 6, credibility: 6, composite: 6 } }),
];

describe("BriefingTab search — desktop", () => {
  it("renders search input on desktop by default", () => {
    renderBriefing(items);
    expect(getSearchInput()).toBeTruthy();
  });

  it("shows normal briefing subtitle when search is empty", () => {
    renderBriefing(items);
    expect(screen.getByTestId("aegis-briefing-insight-count").textContent).toContain("insights selected from");
  });

  it("filters by text content", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "react" } });
    const results = screen.getByTestId("aegis-briefing-search-results");
    expect(results).toBeTruthy();
    // "React hooks guide" and "React Server Components" match
    expect(screen.getByTestId("card-a1")).toBeTruthy();
    expect(screen.getByTestId("card-a4")).toBeTruthy();
    expect(screen.queryByTestId("card-a2")).toBeNull();
    expect(screen.queryByTestId("card-a3")).toBeNull();
  });

  it("filters by author name", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "bob" } });
    expect(screen.getByTestId("card-a2")).toBeTruthy();
    expect(screen.queryByTestId("card-a1")).toBeNull();
  });

  it("filters by topic", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "crypto" } });
    expect(screen.getByTestId("card-a3")).toBeTruthy();
    expect(screen.queryByTestId("card-a1")).toBeNull();
  });

  it("search is case-insensitive", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "RUST" } });
    expect(screen.getByTestId("card-a2")).toBeTruthy();
  });

  it("matches author name appearing in text ('Alice' matches item a5 text)", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "alice" } });
    // a1 (author=Alice) + a5 (text contains "Alice")
    expect(screen.getByTestId("card-a1")).toBeTruthy();
    expect(screen.getByTestId("card-a5")).toBeTruthy();
  });

  it("sorts results by composite score descending", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "react" } });
    const results = screen.getByTestId("aegis-briefing-search-results");
    const cards = results.querySelectorAll("[data-testid^='card-']");
    // a1 (composite=9) should come before a4 (composite=8)
    expect(cards[0].getAttribute("data-testid")).toBe("card-a1");
    expect(cards[1].getAttribute("data-testid")).toBe("card-a4");
  });

  it("shows result count in subtitle", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "react" } });
    const subtitle = screen.getByTestId("aegis-briefing-insight-count").textContent!;
    expect(subtitle).toContain("2 results");
    expect(subtitle).toContain("react");
  });

  it("shows singular 'result' for 1 match", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "bitcoin" } });
    expect(screen.getByTestId("aegis-briefing-insight-count").textContent).toContain("1 result ");
  });

  it("Escape key clears search and restores briefing", () => {
    renderBriefing(items);
    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "react" } });
    expect(screen.getByTestId("aegis-briefing-search-results")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(screen.queryByTestId("aegis-briefing-search-results")).toBeNull();
    expect(screen.getByTestId("aegis-briefing-insight-count").textContent).toContain("insights selected from");
  });

  it("Clear button resets search", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "react" } });
    const clearBtn = screen.getByLabelText("Clear search");
    fireEvent.click(clearBtn);
    expect(getSearchInput().value).toBe("");
    expect(screen.queryByTestId("aegis-briefing-search-results")).toBeNull();
  });

  it("Clear button is hidden when query is empty", () => {
    renderBriefing(items);
    expect(screen.queryByLabelText("Clear search")).toBeNull();
  });
});

describe("BriefingTab search — no matches", () => {
  it("shows empty state when no items match", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "zzzznotfound" } });
    expect(screen.getByTestId("aegis-briefing-search-empty")).toBeTruthy();
    expect(screen.getByText("No matches found")).toBeTruthy();
  });

  it("'clear the search' link in empty state resets query", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "zzzznotfound" } });
    fireEvent.click(screen.getByText("clear the search"));
    expect(getSearchInput().value).toBe("");
    expect(screen.queryByTestId("aegis-briefing-search-empty")).toBeNull();
  });

  it("shows 0 results in subtitle", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "zzzznotfound" } });
    expect(screen.getByTestId("aegis-briefing-insight-count").textContent).toContain("0 results");
  });
});

describe("BriefingTab search — edge cases", () => {
  it("whitespace-only query shows normal briefing (not search)", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "   " } });
    expect(screen.queryByTestId("aegis-briefing-search-results")).toBeNull();
    expect(screen.getByTestId("aegis-briefing-insight-count").textContent).toContain("insights selected from");
  });

  it("single character query works", () => {
    renderBriefing(items);
    fireEvent.change(getSearchInput(), { target: { value: "b" } });
    // Matches: a2 (Bob), a3 (Bitcoin), a5 (books)
    expect(screen.getByTestId("aegis-briefing-search-results")).toBeTruthy();
  });

  it("handles items with undefined topics", () => {
    const itemsWithNoTopics = [
      makeItem({ id: "nt1", text: "No topics here", topics: undefined }),
      makeItem({ id: "nt2", text: "Has topics", topics: ["ai"] }),
    ];
    renderBriefing(itemsWithNoTopics);
    fireEvent.change(getSearchInput(), { target: { value: "ai" } });
    expect(screen.getByTestId("card-nt2")).toBeTruthy();
    expect(screen.queryByTestId("card-nt1")).toBeNull();
  });

  it("handles empty content array", () => {
    renderBriefing([]);
    fireEvent.change(getSearchInput(), { target: { value: "anything" } });
    expect(screen.getByTestId("aegis-briefing-search-empty")).toBeTruthy();
  });

  it("special regex characters in query do not crash", () => {
    renderBriefing(items);
    expect(() => {
      fireEvent.change(getSearchInput(), { target: { value: "[.*+?^${}()|" } });
    }).not.toThrow();
    expect(screen.getByTestId("aegis-briefing-search-empty")).toBeTruthy();
  });
});

describe("BriefingTab search — mobile", () => {
  it("search input is hidden by default on mobile", () => {
    renderBriefing(items, true);
    expect(screen.queryByLabelText("Search briefing content")).toBeNull();
  });

  it("toggle button shows and hides search input on mobile", () => {
    renderBriefing(items, true);
    const toggle = screen.getByLabelText("Toggle search");
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Search briefing content")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByLabelText("Search briefing content")).toBeNull();
  });

  it("Escape on mobile closes search bar", () => {
    renderBriefing(items, true);
    fireEvent.click(screen.getByLabelText("Toggle search"));
    const input = getSearchInput();
    fireEvent.change(input, { target: { value: "react" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Search briefing content")).toBeNull();
  });

  it("toggle button is not present on desktop", () => {
    renderBriefing(items, false);
    expect(screen.queryByLabelText("Toggle search")).toBeNull();
  });
});

describe("BriefingTab search — searches all content, not just briefing", () => {
  it("finds slop-verdict items excluded from briefing priority", () => {
    const mixed = [
      makeItem({ id: "q1", text: "Quality article about AI", verdict: "quality", scores: { originality: 8, insight: 8, credibility: 8, composite: 8 } }),
      makeItem({ id: "s1", text: "Low quality AI spam", verdict: "slop", scores: { originality: 2, insight: 2, credibility: 2, composite: 2 } }),
    ];
    renderBriefing(mixed);
    fireEvent.change(getSearchInput(), { target: { value: "AI" } });
    // Both should appear in search results regardless of verdict
    expect(screen.getByTestId("card-q1")).toBeTruthy();
    expect(screen.getByTestId("card-s1")).toBeTruthy();
  });

  it("finds flagged items excluded from briefing", () => {
    const mixed = [
      makeItem({ id: "f1", text: "Flagged content about React", flagged: true, validated: false }),
    ];
    renderBriefing(mixed);
    fireEvent.change(getSearchInput(), { target: { value: "React" } });
    expect(screen.getByTestId("card-f1")).toBeTruthy();
  });
});
