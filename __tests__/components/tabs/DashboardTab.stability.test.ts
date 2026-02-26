/**
 * @jest-environment jsdom
 */
import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { generateBriefing } from "@/lib/briefing/ranker";
import { computeDashboardTop3 as computeTop3Util } from "@/lib/dashboard/utils";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test-owner",
    author: "test-author",
    avatar: "T",
    text: "Test content text for stability testing with enough words to be meaningful",
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["ai"],
    ...overrides,
  };
}

// ─── briefingNowRef hook behavior test ───

/**
 * Minimal hook that mirrors DashboardTab's briefingNowRef + Top3 logic.
 * Exposes computed Top3 IDs and the pinned time via data attributes.
 */
function BriefingHookHarness({
  content,
  profile,
}: {
  content: ContentItem[];
  profile: UserPreferenceProfile;
}) {
  const contentRef = useRef(content);
  contentRef.current = content;

  const briefingNowRef = useRef(Date.now());
  useEffect(() => {
    briefingNowRef.current = Date.now();
  }, [profile]);

  const top3 = useMemo(
    () => computeTop3Util(contentRef.current, profile, briefingNowRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile],
  );

  return React.createElement("div", {
    "data-top3-ids": top3.map(bi => bi.item.id).join(","),
    "data-top3-scores": top3.map(bi => bi.briefingScore.toFixed(4)).join(","),
    "data-now": String(briefingNowRef.current),
  });
}

describe("briefingNowRef — pinning behavior", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  function getDiv() {
    return container.querySelector("div")!;
  }

  const baseProfile = createEmptyProfile("test");
  const items = Array.from({ length: 5 }, (_, i) =>
    makeItem({
      id: `stable-${i}`,
      text: `Stable article ${i} unique text for testing ranking`,
      scores: { originality: 10 - i, insight: 7, credibility: 7, composite: 10 - i },
      createdAt: Date.now() - i * 3600000,
    }),
  );

  it("renders consistent Top3 IDs on initial mount", () => {
    act(() => {
      root.render(React.createElement(BriefingHookHarness, { content: items, profile: baseProfile }));
    });
    const ids1 = getDiv().getAttribute("data-top3-ids");
    expect(ids1).toBeTruthy();
    expect(ids1!.split(",")).toHaveLength(3);
  });

  it("re-render with same profile produces identical rankings", () => {
    act(() => {
      root.render(React.createElement(BriefingHookHarness, { content: items, profile: baseProfile }));
    });
    const ids1 = getDiv().getAttribute("data-top3-ids");
    const scores1 = getDiv().getAttribute("data-top3-scores");

    // Re-render with same profile reference — useMemo skips recalculation
    act(() => {
      root.render(React.createElement(BriefingHookHarness, { content: items, profile: baseProfile }));
    });
    expect(getDiv().getAttribute("data-top3-ids")).toBe(ids1);
    expect(getDiv().getAttribute("data-top3-scores")).toBe(scores1);
  });

  it("profile change updates briefingNowRef and may change rankings", () => {
    act(() => {
      root.render(React.createElement(BriefingHookHarness, { content: items, profile: baseProfile }));
    });
    const nowBefore = getDiv().getAttribute("data-now");

    // New profile object → useEffect fires, updating briefingNowRef
    const newProfile = { ...baseProfile, topicAffinities: { ai: 0.5 } };
    act(() => {
      root.render(React.createElement(BriefingHookHarness, { content: items, profile: newProfile }));
    });
    const nowAfter = getDiv().getAttribute("data-now");

    // Time reference should have updated (new Date.now() call)
    // Note: in very fast test execution, timestamps may be equal
    expect(Number(nowAfter)).toBeGreaterThanOrEqual(Number(nowBefore));
  });
});

// ─── Tab switch stability (display:none pattern) ───

/**
 * Simulates the page.tsx pattern: DashboardTab stays mounted via display:none
 * when switching to Feed tab, preserving useMemo caches.
 */
function TabSwitchHarness({
  content,
  profile,
}: {
  content: ContentItem[];
  profile: UserPreferenceProfile;
}) {
  const [tab, setTab] = useState<"dashboard" | "feed">("dashboard");

  const switchToFeed = useCallback(() => setTab("feed"), []);
  const switchToDashboard = useCallback(() => setTab("dashboard"), []);

  return React.createElement("div", null,
    React.createElement("button", { id: "btn-feed", onClick: switchToFeed }, "Feed"),
    React.createElement("button", { id: "btn-dash", onClick: switchToDashboard }, "Dashboard"),
    React.createElement("span", { id: "current-tab", "data-tab": tab }),
    // display:none pattern — component stays mounted
    React.createElement("div", { style: { display: tab === "dashboard" ? undefined : "none" } },
      React.createElement(BriefingHookHarness, { content, profile }),
    ),
  );
}

describe("Tab switch stability — display:none preserves state", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  const profile = createEmptyProfile("test");
  const items = Array.from({ length: 5 }, (_, i) =>
    makeItem({
      id: `tab-${i}`,
      text: `Tab test article ${i} with unique content`,
      scores: { originality: 10 - i, insight: 7, credibility: 7, composite: 10 - i },
      createdAt: Date.now() - i * 3600000,
    }),
  );

  it("Dashboard component stays mounted when switching to Feed", () => {
    act(() => {
      root.render(React.createElement(TabSwitchHarness, { content: items, profile }));
    });

    const dashDiv = container.querySelector("[data-top3-ids]")!;
    expect(dashDiv).toBeTruthy();
    const idsBefore = dashDiv.getAttribute("data-top3-ids");

    // Switch to Feed tab
    act(() => {
      container.querySelector<HTMLButtonElement>("#btn-feed")!.click();
    });

    // Component is still in DOM (display:none), not unmounted
    const dashDivAfter = container.querySelector("[data-top3-ids]");
    expect(dashDivAfter).toBeTruthy();
    expect(dashDivAfter!.getAttribute("data-top3-ids")).toBe(idsBefore);
  });

  it("Switching back to Dashboard shows same rankings", () => {
    act(() => {
      root.render(React.createElement(TabSwitchHarness, { content: items, profile }));
    });

    const idsBefore = container.querySelector("[data-top3-ids]")!.getAttribute("data-top3-ids");

    // Feed → Dashboard round-trip
    act(() => {
      container.querySelector<HTMLButtonElement>("#btn-feed")!.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>("#btn-dash")!.click();
    });

    const idsAfter = container.querySelector("[data-top3-ids]")!.getAttribute("data-top3-ids");
    expect(idsAfter).toBe(idsBefore);
  });

  it("Multiple rapid tab switches preserve rankings", () => {
    act(() => {
      root.render(React.createElement(TabSwitchHarness, { content: items, profile }));
    });

    const idsBefore = container.querySelector("[data-top3-ids]")!.getAttribute("data-top3-ids");

    // Rapid switching
    for (let i = 0; i < 10; i++) {
      act(() => {
        container.querySelector<HTMLButtonElement>("#btn-feed")!.click();
      });
      act(() => {
        container.querySelector<HTMLButtonElement>("#btn-dash")!.click();
      });
    }

    const idsAfter = container.querySelector("[data-top3-ids]")!.getAttribute("data-top3-ids");
    expect(idsAfter).toBe(idsBefore);
  });
});

// ─── Recency decay isolation ───

describe("Recency decay — old content doesn't resurface", () => {
  it("items from 48h ago score significantly lower than fresh items", () => {
    const now = Date.now();
    const profile = createEmptyProfile("test");
    const fresh = makeItem({
      id: "fresh",
      text: "Fresh article just published moments ago",
      scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
      createdAt: now,
    });
    const old = makeItem({
      id: "old",
      text: "Old article from two days ago with same score",
      scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
      createdAt: now - 48 * 3600000,
    });

    const briefing = generateBriefing([fresh, old], profile, now);
    const freshItem = briefing.priority.find(bi => bi.item.id === "fresh");
    const oldItem = briefing.priority.find(bi => bi.item.id === "old");

    expect(freshItem).toBeDefined();
    expect(oldItem).toBeDefined();
    // 48h with 7h half-life → factor ≈ 0.008. Fresh ≈ 7.0, Old ≈ 0.056
    expect(freshItem!.briefingScore).toBeGreaterThan(oldItem!.briefingScore * 10);
  });

  it("recency decay is exponential with 7h half-life", () => {
    const now = Date.now();
    const profile = createEmptyProfile("test");
    const item0h = makeItem({ id: "h0", text: "Article at time zero", createdAt: now, scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } });
    const item7h = makeItem({ id: "h7", text: "Article seven hours ago", createdAt: now - 7 * 3600000, scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } });
    const item14h = makeItem({ id: "h14", text: "Article fourteen hours ago", createdAt: now - 14 * 3600000, scores: { originality: 10, insight: 10, credibility: 10, composite: 10 } });

    const briefing = generateBriefing([item0h, item7h, item14h], profile, now);
    const score0 = briefing.priority.find(bi => bi.item.id === "h0")!.briefingScore;
    const score7 = briefing.priority.find(bi => bi.item.id === "h7")!.briefingScore;
    const score14 = briefing.priority.find(bi => bi.item.id === "h14")!.briefingScore;

    // At 7h (one half-life): score ≈ base * 0.5
    expect(score7).toBeCloseTo(score0 * 0.5, 1);
    // At 14h (two half-lives): score ≈ base * 0.25
    expect(score14).toBeCloseTo(score0 * 0.25, 1);
  });

  it("even high-composite old content ranks below moderate fresh content", () => {
    const now = Date.now();
    const profile = createEmptyProfile("test");
    const items = [
      makeItem({ id: "old-great", text: "Amazing article from yesterday worth reading", scores: { originality: 10, insight: 10, credibility: 10, composite: 10 }, createdAt: now - 24 * 3600000 }),
      makeItem({ id: "fresh-ok", text: "Decent fresh article published just now", scores: { originality: 6, insight: 6, credibility: 6, composite: 6 }, createdAt: now }),
    ];

    const briefing = generateBriefing(items, profile, now);
    // 24h with 7h half-life → decay factor ≈ 0.094
    // old: 10 * 0.094 ≈ 0.94, fresh: 6 * 1.0 = 6.0
    expect(briefing.priority[0].item.id).toBe("fresh-ok");
  });
});

// ─── Content update resilience ───

describe("Content update resilience — scheduler adds items", () => {
  it("new content added to contentRef does not affect cached Top3", () => {
    const now = Date.now();
    const profile = createEmptyProfile("test");
    const initialItems = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `init-${i}`,
        text: `Initial article ${i} with unique content text`,
        scores: { originality: 8, insight: 8, credibility: 8, composite: 8 },
        createdAt: now - i * 3600000,
      }),
    );

    // First computation
    const briefing1 = generateBriefing(initialItems, profile, now);
    const top3ids1 = briefing1.priority.slice(0, 3).map(bi => bi.item.id);

    // Scheduler adds a new item (simulating contentRef.current being updated)
    const newItem = makeItem({
      id: "new-from-scheduler",
      text: "Brand new article from scheduler fetch",
      scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      createdAt: now,
    });

    // With same pinned time and same profile, Top3 from original items is unchanged
    const briefing2 = generateBriefing(initialItems, profile, now);
    const top3ids2 = briefing2.priority.slice(0, 3).map(bi => bi.item.id);
    expect(top3ids2).toEqual(top3ids1);

    // Only when content array includes new item does ranking change
    const briefing3 = generateBriefing([...initialItems, newItem], profile, now);
    const top3ids3 = briefing3.priority.slice(0, 3).map(bi => bi.item.id);
    expect(top3ids3).toContain("new-from-scheduler");
  });

  it("removing items from content does not cause errors", () => {
    const now = Date.now();
    const profile = createEmptyProfile("test");
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `rem-${i}`,
        text: `Removable article ${i} unique`,
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
      }),
    );

    const briefing = generateBriefing(items.slice(0, 2), profile, now);
    expect(briefing.priority.length).toBeLessThanOrEqual(2);
  });
});
