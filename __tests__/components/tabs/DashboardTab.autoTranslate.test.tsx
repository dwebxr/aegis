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

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: {
      topicAffinities: {},
      authorTrust: {},
      recentTopics: [],
      totalValidated: 0,
      totalFlagged: 0,
      calibration: { qualityThreshold: 5.5 },
      bookmarkedIds: [],
      translationPrefs: { targetLanguage: "ja", policy: "all", backend: "auto", minScore: 6 },
    },
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
});
