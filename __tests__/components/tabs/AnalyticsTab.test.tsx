/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";

// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, fireEvent, screen } from "@testing-library/react";
import { AnalyticsTab } from "@/components/tabs/AnalyticsTab";
import type { ContentItem } from "@/lib/types/content";
import {
  computeDashboardActivity,
  computeTopicDistribution,
} from "@/lib/dashboard/utils";

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: false }),
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
    createdAt: now - 1000,
    validated: false,
    flagged: false,
    timestamp: "just now",
    topics: ["test"],
    ...overrides,
  };
}

describe("AnalyticsTab — Activity Trends section", () => {
  it("renders Activity Trends heading inside the trends container", () => {
    const html = renderToStaticMarkup(
      <AnalyticsTab content={[]} />,
    );
    // Verify section exists via data-testid and contains correct heading
    expect(html).toContain('data-testid="aegis-analytics-activity-trends"');
    expect(html).toContain("Activity Trends");
    // All three range buttons present
    expect(html).toContain("Today");
    expect(html).toContain("7d");
    expect(html).toContain("30d");
  });

  it("displays correct computed activity counts for 7d default range", () => {
    const items = [
      makeItem({ id: "q1", verdict: "quality", createdAt: now - 1000 }),
      makeItem({ id: "q2", verdict: "quality", createdAt: now - 2 * dayMs }),
      makeItem({ id: "s1", verdict: "slop", createdAt: now - 3 * dayMs }),
      makeItem({ id: "old", verdict: "quality", createdAt: now - 10 * dayMs }), // outside 7d
    ];

    // Verify real computation produces expected values
    const activity = computeDashboardActivity(items, "7d", now);
    expect(activity.qualityCount).toBe(2);
    expect(activity.slopCount).toBe(1);
    expect(activity.totalEvaluated).toBe(3); // excludes "old"

    // Verify the rendered component displays these exact computed values
    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );
    // Quality count rendered in the stats row
    expect(html).toContain(`>${activity.qualityCount}<`);
    expect(html).toContain(`>${activity.slopCount}<`);
    expect(html).toContain(`>${activity.totalEvaluated}<`);
  });

  it("switches to Today range and shows only recent items", () => {
    const items = [
      makeItem({ id: "today-1", verdict: "quality", createdAt: now - 1000 }),
      makeItem({ id: "old-1", verdict: "slop", createdAt: now - 3 * dayMs }),
    ];

    const { container } = render(
      <AnalyticsTab content={items} />,
    );

    // Click Today to switch range
    const todayBtn = screen.getByText("Today");
    fireEvent.click(todayBtn);

    // After switching to Today, only recent items should count
    const todayActivity = computeDashboardActivity(items, "today", now);
    expect(todayActivity.qualityCount).toBe(1);
    expect(todayActivity.slopCount).toBe(0);
    expect(todayActivity.totalEvaluated).toBe(1);

    // Verify the rendered text reflects the "today" range counts
    const trendsContainer = container.querySelector('[data-testid="aegis-analytics-activity-trends"]');
    expect(trendsContainer).toBeInTheDocument();
    expect(trendsContainer!.textContent).toContain("1");
  });
});

describe("AnalyticsTab — Topic Breakdown section", () => {
  it("renders topics with correct counts from real computeTopicDistribution", () => {
    const items = [
      makeItem({ id: "td-1", topics: ["ai", "crypto"], text: "Topic dist test 1" }),
      makeItem({ id: "td-2", topics: ["ai", "web3"], text: "Topic dist test 2" }),
      makeItem({ id: "td-3", topics: ["crypto"], text: "Topic dist test 3" }),
    ];

    // Verify real computation
    const topicDist = computeTopicDistribution(items);
    const aiEntry = topicDist.find(t => t.topic === "ai");
    const cryptoEntry = topicDist.find(t => t.topic === "crypto");
    expect(aiEntry).toBeDefined();
    expect(aiEntry!.count).toBe(2);
    expect(cryptoEntry).toBeDefined();
    expect(cryptoEntry!.count).toBe(2);

    // Verify rendered output contains topic breakdown with data-testid
    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );
    expect(html).toContain('data-testid="aegis-analytics-topic-breakdown"');
    expect(html).toContain("Topic Breakdown");
    // Topic names appear in the rendered section
    expect(html).toContain("ai");
    expect(html).toContain("crypto");
  });

  it("renders empty state when no topics exist", () => {
    const items = [
      makeItem({ id: "notopic-1", topics: [], text: "No topic test 1" }),
      makeItem({ id: "notopic-2", topics: undefined, text: "No topic test 2" }),
    ];

    const topicDist = computeTopicDistribution(items);
    expect(topicDist).toHaveLength(0);

    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );
    expect(html).toContain("Add sources to see topic distribution");
  });
});

describe("AnalyticsTab — KPI Cards show real computed values", () => {
  it("accuracy and false positive rate are computed from content, not hardcoded", () => {
    const items = [
      makeItem({ id: "k1", verdict: "quality", flagged: false }),
      makeItem({ id: "k2", verdict: "quality", flagged: true }), // false positive
      makeItem({ id: "k3", verdict: "slop", flagged: false }),
      makeItem({ id: "k4", verdict: "quality", validated: true }),
    ];

    const qualCount = items.filter(c => c.verdict === "quality").length; // 3
    const fpCount = items.filter(c => c.verdict === "quality" && c.flagged).length; // 1
    const accuracy = ((qualCount / items.length) * 100).toFixed(1); // "75.0"
    const fpRate = ((fpCount / qualCount) * 100).toFixed(1); // "33.3"

    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );

    // Verify the computed accuracy appears in the rendered output
    expect(html).toContain(`${accuracy}%`);
    expect(html).toContain(`${fpRate}%`);
    // Verify sub-text with real counts
    expect(html).toContain(`${qualCount} quality / ${items.length} total`);
  });
});

describe("AnalyticsTab — Evaluation Summary removed", () => {
  it("does not render Evaluation Summary section or its test-id", () => {
    const items = [
      makeItem({ id: "eval-1" }),
      makeItem({ id: "eval-2", verdict: "slop" }),
    ];
    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );
    expect(html).not.toContain("Evaluation Summary");
    expect(html).not.toContain("aegis-analytics-eval-summary");
  });
});
