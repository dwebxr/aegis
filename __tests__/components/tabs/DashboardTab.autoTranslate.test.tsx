/**
 * @jest-environment jsdom
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
import { render, waitFor } from "@testing-library/react";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import type { ContentItem } from "@/lib/types/content";

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({ filterMode: "lite", setFilterMode: jest.fn() }),
}));

// STABLE object identity, matching the real PreferenceContext (memoized):
// a fresh profile literal per render would recompute the section memos on
// EVERY render and make the translatedCount display test tautological.
const STABLE_PROFILE = {
  topicAffinities: {},
  authorTrust: {},
  recentTopics: [],
  totalValidated: 0,
  totalFlagged: 0,
  calibration: { qualityThreshold: 5.5 },
  bookmarkedIds: [],
  translationPrefs: { targetLanguage: "ja", policy: "all", backend: "auto", minScore: 6 },
};

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: STABLE_PROFILE,
    addFilterRule: jest.fn(),
    bookmarkItem: jest.fn(),
    unbookmarkItem: jest.fn(),
  }),
}));

jest.mock("@/components/ui/D2ANetworkMini", () => ({
  D2ANetworkMini: () => null,
}));

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({ sources: [] }),
}));

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: false }),
}));

const now = Date.now();

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item",
    owner: "owner",
    author: "Author",
    avatar: "A",
    text: "unique text",
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "reason",
    createdAt: now,
    validated: false,
    flagged: false,
    timestamp: "now",
    topics: ["test"],
    ...overrides,
  };
}

describe("DashboardTab auto-translation visibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("requests rendered filtered feed IDs, not array-head unrendered IDs", async () => {
    const arrayHeadSlop = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `head-${i}`,
        text: `array head slop ${i}`,
        verdict: "slop",
        createdAt: now + 10_000 - i,
      }),
    );
    const qualityItems = Array.from({ length: 45 }, (_, i) =>
      makeItem({
        id: `visible-${i}`,
        text: `visible quality ${i}`,
        createdAt: now - i,
      }),
    );
    const onAutoTranslate = jest.fn();

    render(
      <DashboardTab
        content={[...arrayHeadSlop, ...qualityItems]}
        onValidate={jest.fn()}
        onFlag={jest.fn()}
        onAutoTranslate={onAutoTranslate}
      />,
    );

    await waitFor(() => expect(onAutoTranslate).toHaveBeenCalledTimes(40));
    const requestedIds = onAutoTranslate.mock.calls.map(call => call[0]);

    expect(requestedIds).toEqual(expect.arrayContaining(qualityItems.slice(0, 40).map(item => item.id)));
    for (const item of arrayHeadSlop) expect(requestedIds).not.toContain(item.id);
    for (const item of qualityItems.slice(40)) expect(requestedIds).not.toContain(item.id);
  });

  it("dashboard mode requests translation for its visible section items (Codex P2)", async () => {
    // Dashboard-mode sections render DashboardCard (no per-card effect) —
    // the tab-level effect must cover them or dashboard-mode users get no
    // auto-translation at all after the whole-array scan removal.
    localStorage.setItem("aegis-home-mode", "dashboard");
    const qualityItems = Array.from({ length: 10 }, (_, i) =>
      makeItem({
        id: `dash-${i}`,
        text: `dashboard quality ${i}`,
        createdAt: now - i,
      }),
    );
    const onAutoTranslate = jest.fn();

    render(
      <DashboardTab
        content={qualityItems}
        onValidate={jest.fn()}
        onFlag={jest.fn()}
        onAutoTranslate={onAutoTranslate}
      />,
    );

    // Top-3 is always computed in dashboard mode — its ids must be requested.
    await waitFor(() => expect(onAutoTranslate).toHaveBeenCalled());
    const requestedIds = onAutoTranslate.mock.calls.map(call => call[0]);
    expect(requestedIds.length).toBeGreaterThanOrEqual(3);
    // Bounded: never the whole content array in one burst beyond section caps.
    expect(new Set(requestedIds).size).toBeLessThanOrEqual(qualityItems.length);
  });

  it("dashboard mode DISPLAYS a translation that lands without a content-length change (Opus P2 r4)", async () => {
    // Section memos key on content.length; a completed translation changes
    // identity only — the translatedCount dep must force a recompute or the
    // paid-for translation never appears while sitting in dashboard mode.
    localStorage.setItem("aegis-home-mode", "dashboard");
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem({ id: `t-${i}`, text: `english text ${i}`, createdAt: now - i }),
    );
    const { rerender, container } = render(
      <DashboardTab
        content={items}
        onValidate={jest.fn()}
        onFlag={jest.fn()}
        onAutoTranslate={jest.fn()}
      />,
    );
    expect(container.textContent).not.toContain("日本語訳テキスト");

    // Same length, same ids — one item now carries a translation.
    const patched = items.map((item, i) => i === 0
      ? { ...item, translation: { translatedText: "日本語訳テキスト", targetLanguage: "ja" as const, backend: "ic-llm" as const, generatedAt: now } }
      : item,
    );
    rerender(
      <DashboardTab
        content={patched}
        onValidate={jest.fn()}
        onFlag={jest.fn()}
        onAutoTranslate={jest.fn()}
      />,
    );
    await waitFor(() => expect(container.textContent).toContain("日本語訳テキスト"));
  });

  it("dashboard mode with translated items does not re-request them", async () => {
    localStorage.setItem("aegis-home-mode", "dashboard");
    const translated = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `done-${i}`,
        text: `already translated ${i}`,
        createdAt: now - i,
        translation: {
          translatedText: "翻訳済み",
          targetLanguage: "ja",
          backend: "ic-llm",
          generatedAt: now,
        },
      }),
    );
    const onAutoTranslate = jest.fn();

    render(
      <DashboardTab
        content={translated}
        onValidate={jest.fn()}
        onFlag={jest.fn()}
        onAutoTranslate={onAutoTranslate}
      />,
    );

    await new Promise(r => setTimeout(r, 50));
    expect(onAutoTranslate).not.toHaveBeenCalled();
  });
});
