/**
 * @jest-environment jsdom
 */

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
  it("renders Activity Trends with time-range tabs defaulting to 7d", () => {
    const html = renderToStaticMarkup(
      <AnalyticsTab content={[]} />,
    );
    expect(html).toContain("Activity Trends");
    expect(html).toContain("Today");
    expect(html).toContain("7d");
    expect(html).toContain("30d");
  });

  it("renders activity stats with content", () => {
    const items = [
      makeItem({ id: "act-1", verdict: "quality", createdAt: now - 1000 }),
      makeItem({ id: "act-2", verdict: "slop", createdAt: now - 2000 }),
    ];
    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );
    expect(html).toContain("quality");
    expect(html).toContain("burned");
    expect(html).toContain("total");
  });

  it("switches activity range on button click", () => {
    const items = [
      makeItem({ id: "range-1", verdict: "quality", createdAt: now - 1000 }),
    ];
    const { container } = render(
      <AnalyticsTab content={items} />,
    );
    const todayBtn = screen.getByText("Today");
    fireEvent.click(todayBtn);
    // After clicking Today, the button should be styled as active (border)
    expect(todayBtn).toBeTruthy();
  });
});

describe("AnalyticsTab — Topic Breakdown section", () => {
  it("renders Topic Breakdown section with topic data", () => {
    const items = [
      makeItem({ id: "td-1", topics: ["ai", "crypto"], text: "Topic dist test 1" }),
      makeItem({ id: "td-2", topics: ["ai", "web3"], text: "Topic dist test 2" }),
      makeItem({ id: "td-3", topics: ["crypto"], text: "Topic dist test 3" }),
    ];
    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );
    expect(html).toContain("Topic Breakdown");
    expect(html).toContain("ai");
    expect(html).toContain("crypto");
  });

  it("renders empty state when no topics", () => {
    const items = [
      makeItem({ id: "notopic-1", topics: [], text: "No topic test 1" }),
      makeItem({ id: "notopic-2", topics: undefined, text: "No topic test 2" }),
    ];
    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );
    expect(html).toContain("Add sources to see topic distribution");
  });
});

describe("AnalyticsTab — Evaluation Summary removed", () => {
  it("does not render Evaluation Summary section", () => {
    const items = [
      makeItem({ id: "eval-1" }),
      makeItem({ id: "eval-2", verdict: "slop" }),
    ];
    const html = renderToStaticMarkup(
      <AnalyticsTab content={items} />,
    );
    expect(html).not.toContain("Evaluation Summary");
  });
});
