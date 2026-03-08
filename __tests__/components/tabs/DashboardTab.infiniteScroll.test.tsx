/**
 * @jest-environment jsdom
 *
 * Comprehensive tests for Home Feed infinite scroll — batch loading, separators,
 * boundary conditions, animation, keyboard nav, filter interactions.
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

// ─── Helpers ───

const now = Date.now();
let _seq = 0;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const n = _seq++;
  return {
    id: `inf-${n}`,
    owner: "test",
    author: "Author",
    avatar: "A",
    text: `Infinite scroll test ${n} ${Math.random().toString(36).slice(2)}`,
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

function getBatchSeparators(): Element[] {
  return Array.from(document.querySelectorAll('[data-testid="aegis-batch-separator"]'));
}

const noop = jest.fn();

beforeEach(() => {
  localStorage.clear();
  mockProfile.bookmarkedIds = [];
  _seq = 0;
});

// ─── Batch boundary conditions ───

describe("DashboardTab — Batch boundaries", () => {
  it("exactly 40 items: all visible, no Load remaining, no batch separator", () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      makeItem({ id: `b40-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    expect(getCardIds()).toHaveLength(40);
    expect(screen.queryByText(/Load remaining/)).toBeNull();
    expect(getBatchSeparators()).toHaveLength(0);
  });

  it("exactly 41 items: 40 visible, Load remaining shows '1 items'", () => {
    const items = Array.from({ length: 41 }, (_, i) =>
      makeItem({ id: `b41-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    expect(getCardIds()).toHaveLength(40);
    const btn = screen.getByTestId("aegis-load-remaining");
    expect(btn.textContent).toContain("1 items");
  });

  it("exactly 80 items: first Load remaining shows 40, second load completes", () => {
    const items = Array.from({ length: 80 }, (_, i) =>
      makeItem({ id: `b80-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    expect(getCardIds()).toHaveLength(40);

    // First load
    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getCardIds()).toHaveLength(80);
    // All loaded — button gone
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();
  });

  it("0 items: no cards, no Load remaining, no separator", () => {
    render(<DashboardTab content={[]} onValidate={noop} onFlag={noop} isLoading={true} />);
    expect(getCardIds()).toHaveLength(0);
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();
    expect(getBatchSeparators()).toHaveLength(0);
  });

  it("1 item: renders single card, no Load remaining", () => {
    render(<DashboardTab content={[makeItem()]} onValidate={noop} onFlag={noop} />);
    expect(getCardIds()).toHaveLength(1);
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();
  });
});

// ─── Batch separator content ───

describe("DashboardTab — Batch separators", () => {
  it("separator appears at position 40 with correct text", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `sep-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    // Load second batch
    fireEvent.click(screen.getByTestId("aegis-load-remaining"));

    const separators = getBatchSeparators();
    expect(separators).toHaveLength(1);
    expect(separators[0].textContent).toContain("Showing 40 of 50 items");
  });

  it("multiple separators for 3 batches (120 items → load twice)", () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      makeItem({ id: `msep-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);

    // First load → items 41-80
    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getBatchSeparators()).toHaveLength(1);
    expect(getBatchSeparators()[0].textContent).toContain("Showing 40 of 100 items");

    // Second load → items 81-100
    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getBatchSeparators()).toHaveLength(2);
    expect(getBatchSeparators()[1].textContent).toContain("Showing 80 of 100 items");
  });

  it("no separator in first batch even with 40 items", () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      makeItem({ id: `nosep-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    expect(getBatchSeparators()).toHaveLength(0);
  });
});

// ─── "All loaded" end separator ───

describe("DashboardTab — End separator", () => {
  it("shows 'Showing N of N' when all items loaded and N > 40", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `end-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    fireEvent.click(screen.getByTestId("aegis-load-remaining"));

    // End separator should appear
    const allText = document.body.textContent!;
    expect(allText).toContain("Showing 50 of 50 items");
  });

  it("does not show end separator when items fit in one batch", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      makeItem({ id: `noend-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    expect(document.body.textContent).not.toContain("Showing 30 of 30 items");
  });
});

// ─── Stagger animation ───

describe("DashboardTab — Stagger animation", () => {
  it("first batch items have stagger animation, second batch does not", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `anim-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);

    // First batch: check first and last item have animation
    const firstCard = document.getElementById("card-anim-0")?.parentElement;
    const lastFirstBatch = document.getElementById("card-anim-39")?.parentElement;
    expect(firstCard?.style.animation).toContain("slideUp");
    expect(lastFirstBatch?.style.animation).toContain("slideUp");

    // Load second batch
    fireEvent.click(screen.getByTestId("aegis-load-remaining"));

    // Second batch: item 40 should NOT have stagger animation
    const firstSecondBatch = document.getElementById("card-anim-40")?.parentElement;
    expect(firstSecondBatch?.style.animation).toBeFalsy();
  });

  it("stagger delay increases linearly within first batch", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `delay-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);

    const card0 = document.getElementById("card-delay-0")?.parentElement;
    const card4 = document.getElementById("card-delay-4")?.parentElement;
    // card0: 0 * 0.03 = 0s, card4: 4 * 0.03 = 0.12s
    expect(card0?.style.animation).toContain("0s");
    expect(card4?.style.animation).toContain("0.12s");
  });
});

// ─── Multi-batch progression ───

describe("DashboardTab — Multi-batch loading", () => {
  it("three successive Load remaining clicks load all 130 items", () => {
    const items = Array.from({ length: 130 }, (_, i) =>
      makeItem({ id: `multi-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);

    expect(getCardIds()).toHaveLength(40);
    expect(screen.getByTestId("aegis-load-remaining").textContent).toContain("90 items");

    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getCardIds()).toHaveLength(80);
    expect(screen.getByTestId("aegis-load-remaining").textContent).toContain("50 items");

    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getCardIds()).toHaveLength(120);
    expect(screen.getByTestId("aegis-load-remaining").textContent).toContain("10 items");

    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getCardIds()).toHaveLength(130);
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();
  });

  it("batch separators accumulate correctly across loads", () => {
    const items = Array.from({ length: 130 }, (_, i) =>
      makeItem({ id: `bsep-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);

    fireEvent.click(screen.getByTestId("aegis-load-remaining")); // 80
    fireEvent.click(screen.getByTestId("aegis-load-remaining")); // 120
    fireEvent.click(screen.getByTestId("aegis-load-remaining")); // 130

    const seps = getBatchSeparators();
    expect(seps).toHaveLength(3);
    expect(seps[0].textContent).toContain("Showing 40 of 130");
    expect(seps[1].textContent).toContain("Showing 80 of 130");
    expect(seps[2].textContent).toContain("Showing 120 of 130");
  });
});

// ─── Sentinel presence ───

describe("DashboardTab — Sentinel element", () => {
  it("sentinel div exists when more items remain", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `sent-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    // Sentinel is a 1px-high div right before the Load remaining button
    const loadBtn = screen.getByTestId("aegis-load-remaining");
    const sentinel = loadBtn.previousElementSibling;
    expect(sentinel).toBeTruthy();
    expect(sentinel?.className).toContain("h-1");
  });

  it("sentinel div absent when all items loaded", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      makeItem({ id: `nosent-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    // No Load remaining button = no sentinel
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();
    // No sentinel div in the dashboard
    expect(screen.queryByTestId("aegis-scroll-sentinel")).toBeNull();
  });
});

// ─── Filter interaction with infinite scroll ───

describe("DashboardTab — Filter resets batch state", () => {
  it("switching to validated filter resets to first batch", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({
        id: `filt-${i}`,
        createdAt: now - i * 1000,
        validated: i < 3,
        validatedAt: i < 3 ? now : undefined,
      }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);

    // Load all
    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getCardIds()).toHaveLength(50);

    // Switch to validated filter → only 3 items, resets batch
    fireEvent.click(screen.getByTestId("aegis-filter-validated"));
    const validatedCards = getCardIds();
    expect(validatedCards).toHaveLength(3);
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();
    expect(getBatchSeparators()).toHaveLength(0);
  });

  it("switching filter back to quality after loading restarts from batch 1", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `back-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);

    // Load all
    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getCardIds()).toHaveLength(50);

    // Switch filter away and back
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    fireEvent.click(screen.getByTestId("aegis-filter-all"));
    // Back to quality
    fireEvent.click(screen.getByTestId("aegis-filter-quality"));

    // Should reset to first batch
    expect(getCardIds()).toHaveLength(40);
    expect(screen.getByTestId("aegis-load-remaining")).toBeTruthy();
  });

  it("source filter change resets batch", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `src-${i}`, source: i % 2 === 0 ? "rss" : "nostr", createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);

    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(getCardIds()).toHaveLength(50);

    // Filter by source
    fireEvent.click(screen.getByTestId("aegis-filter-more"));
    // Click "rss" source button (inside the more filters panel)
    const panel = screen.getByTestId("aegis-filter-more-panel");
    const rssBtn = Array.from(panel.querySelectorAll("button")).find(b => b.textContent === "rss");
    expect(rssBtn).toBeTruthy();
    fireEvent.click(rssBtn!);

    // Should show only rss items (25), within one batch
    const cards = getCardIds();
    expect(cards.length).toBe(25);
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();
  });
});

// ─── Keyboard navigation with visible items ───

describe("DashboardTab — Keyboard nav across batches", () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView
    Element.prototype.scrollIntoView = jest.fn();
  });

  it("J/K navigates within visible batch items", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `kb-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} mobile={false} />);

    // Press J to focus first item
    fireEvent.keyDown(document, { key: "j" });
    const card0 = document.getElementById("card-kb-0");
    expect(card0?.className).toContain("outline");

    // Press J again to move to second
    fireEvent.keyDown(document, { key: "j" });
    const card1 = document.getElementById("card-kb-1");
    expect(card1?.className).toContain("outline");

    // Press K to go back
    fireEvent.keyDown(document, { key: "k" });
    expect(document.getElementById("card-kb-0")?.className).toContain("outline");
  });
});

// ─── Load remaining button styling and data ───

describe("DashboardTab — Load remaining button", () => {
  it("button has correct data-testid", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `tid-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    expect(screen.getByTestId("aegis-load-remaining")).toBeTruthy();
  });

  it("remaining count updates after each load", () => {
    const items = Array.from({ length: 90 }, (_, i) =>
      makeItem({ id: `upd-${i}`, createdAt: now - i * 1000 }),
    );
    render(<DashboardTab content={items} onValidate={noop} onFlag={noop} />);
    expect(screen.getByTestId("aegis-load-remaining").textContent).toContain("50 items");

    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(screen.getByTestId("aegis-load-remaining").textContent).toContain("10 items");

    fireEvent.click(screen.getByTestId("aegis-load-remaining"));
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();
  });
});

// ─── Content arriving after initial render ───

describe("DashboardTab — Dynamic content changes", () => {
  it("new content prop increases total but visible stays capped at BATCH_SIZE", () => {
    const initial = Array.from({ length: 30 }, (_, i) =>
      makeItem({ id: `dyn-${i}`, createdAt: now - i * 1000 }),
    );
    const { rerender } = render(
      <DashboardTab content={initial} onValidate={noop} onFlag={noop} />,
    );
    expect(getCardIds()).toHaveLength(30);
    expect(screen.queryByTestId("aegis-load-remaining")).toBeNull();

    // New content arrives (50 total)
    const updated = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeItem({ id: `dyn-new-${i}`, createdAt: now + (20 - i) * 1000 }),
      ),
      ...initial,
    ];
    rerender(<DashboardTab content={updated} onValidate={noop} onFlag={noop} />);

    // Now 50 items, but visibleCount is still 40
    expect(getCardIds()).toHaveLength(40);
    expect(screen.getByTestId("aegis-load-remaining").textContent).toContain("10 items");
  });
});
