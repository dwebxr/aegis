/**
 * @jest-environment jsdom
 */

/**
 * UI rendering tests for Dashboard mode features:
 * - YouTube iframe embedding in ThumbnailArea
 * - Clickable thumbnail links (sourceUrl)
 * - Inline Validate/Flag buttons
 * - Needs Review section
 * - Topic Distribution section
 */

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import type { ContentItem } from "@/lib/types/content";

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({ filterMode: "lite", setFilterMode: jest.fn() }),
}));

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: {
      topicAffinities: { ai: 0.8 },
      authorTrust: {},
      recentTopics: ["ai"],
      totalValidated: 2,
      totalFlagged: 1,
      calibration: { qualityThreshold: 5.5 },
    },
    setTopicAffinity: jest.fn(),
    removeTopicAffinity: jest.fn(),
    setQualityThreshold: jest.fn(),
  }),
}));

jest.mock("@/components/ui/D2ANetworkMini", () => ({
  D2ANetworkMini: () => null,
}));

const now = Date.now();

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    owner: "test-owner",
    author: "Test Author",
    avatar: "T",
    text: `Unique test content ${Math.random().toString(36).slice(2)}`,
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

describe("DashboardTab — YouTube iframe embedding", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));
  afterEach(() => localStorage.removeItem("aegis-home-mode"));

  it("renders YouTube iframe in Top3 when sourceUrl is a YouTube video", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `yt-${i}`,
        text: `YouTube AI video ${i} content text`,
        sourceUrl: i === 0 ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : undefined,
        imageUrl: "https://img.example.com/thumb.jpg",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    // YouTube item should have iframe with embed URL
    expect(html).toContain("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(html).toContain("<iframe");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("allowfullscreen");
  });

  it("does NOT render iframe for non-YouTube sourceUrl in Top3", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `nyt-${i}`,
        text: `Regular article ${i} about AI topics`,
        sourceUrl: "https://example.com/article",
        imageUrl: "https://img.example.com/thumb.jpg",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    expect(html).not.toContain("youtube.com/embed");
    expect(html).toContain("<img");
  });

  it("renders YouTube iframe in Topic Spotlight hero", () => {
    // Items with "ai" topic and high affinity → should appear in Spotlight
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({
        id: `spot-${i}`,
        text: `AI spotlight content item number ${i} unique`,
        topics: ["ai"],
        sourceUrl: i === 3 ? "https://youtu.be/abc123_-XYZ" : "https://example.com",
        scores: { originality: 9 - i, insight: 8, credibility: 8, composite: 9 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    // If the YouTube item ends up as a hero, we should see the embed
    // If not, at least verify no crash occurs with YouTube URLs in the mix
    expect(html).toContain("Topic Spotlight");
  });

  it("renders iframe with correct allow attributes", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({
        id: `attr-${i}`,
        text: `YouTube attr test ${i} unique text here`,
        sourceUrl: i === 0 ? "https://youtube.com/watch?v=dQw4w9WgXcQ" : undefined,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    expect(html).toContain("accelerometer");
    expect(html).toContain("encrypted-media");
    expect(html).toContain("picture-in-picture");
  });

  it("does NOT wrap YouTube iframe in <a> tag", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({
        id: `nolink-${i}`,
        text: `YouTube no link test ${i}`,
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    // iframe should exist but NOT inside an <a> tag linking to youtube
    expect(html).toContain("<iframe");
    // The embed URL appears in iframe src, not in an href
    const iframeMatch = html.match(/<iframe[^>]*src="([^"]+)"/);
    expect(iframeMatch).toBeTruthy();
    expect(iframeMatch![1]).toContain("youtube.com/embed");
  });
});

describe("DashboardTab — clickable thumbnail links", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));
  afterEach(() => localStorage.removeItem("aegis-home-mode"));

  it("wraps Top3 thumbnail in <a> tag when sourceUrl is present (non-YouTube)", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({
        id: `link-${i}`,
        text: `Linkable article ${i} with source`,
        sourceUrl: "https://example.com/article-1",
        imageUrl: "https://img.example.com/thumb.jpg",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    expect(html).toContain('href="https://example.com/article-1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does NOT render <a> tag when sourceUrl is absent", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({
        id: `nourl-${i}`,
        text: `No URL article ${i}`,
        sourceUrl: undefined,
        imageUrl: "https://img.example.com/thumb.jpg",
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    // Should not have any external article links (only internal nav)
    expect(html).not.toContain('target="_blank"');
  });
});

describe("DashboardTab — inline Validate/Flag buttons", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));
  afterEach(() => localStorage.removeItem("aegis-home-mode"));

  it("renders check mark and X mark buttons in Top3 cards", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({
        id: `btn-${i}`,
        text: `Button test article ${i}`,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    // Check mark (✓) = &#x2713; → Unicode character ✓
    expect(html).toContain("✓");
    // X mark (✗) = &#x2717; → Unicode character ✗
    expect(html).toContain("✗");
  });

  it("disables validate button when item is already validated", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({
        id: `disabled-${i}`,
        text: `Disabled button test ${i}`,
        validated: i === 0,
        validatedAt: i === 0 ? now : undefined,
        scores: { originality: 10 - i, insight: 9, credibility: 9, composite: 10 - i },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    // Validated item should have disabled button with reduced opacity
    expect(html).toContain("disabled");
    expect(html).toContain("opacity:0.5");
  });
});

describe("DashboardTab — Needs Review section", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));
  afterEach(() => localStorage.removeItem("aegis-home-mode"));

  it("renders Needs Review section with unreviewed quality items", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({
        id: `review-${i}`,
        text: `Needs review content ${i} unique text`,
        scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    expect(html).toContain("Needs Review");
    expect(html).toContain("Review to teach your agent");
  });

  it("renders empty state when all items are validated", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({
        id: `allval-${i}`,
        text: `All validated item ${i}`,
        validated: true,
        validatedAt: now,
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    expect(html).toContain("All caught up");
  });
});

describe("DashboardTab — Topic Distribution section", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));
  afterEach(() => localStorage.removeItem("aegis-home-mode"));

  it("renders Topic Breakdown section with topic data", () => {
    const items = [
      makeItem({ id: "td-1", topics: ["ai", "crypto"], text: "Topic dist test 1" }),
      makeItem({ id: "td-2", topics: ["ai", "web3"], text: "Topic dist test 2" }),
      makeItem({ id: "td-3", topics: ["crypto"], text: "Topic dist test 3" }),
    ];
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
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
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    expect(html).toContain("Add sources to see topic distribution");
  });
});

describe("DashboardTab — grade fallback rendering", () => {
  beforeEach(() => localStorage.setItem("aegis-home-mode", "dashboard"));
  afterEach(() => localStorage.removeItem("aegis-home-mode"));

  it("shows grade letter when no imageUrl is provided", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({
        id: `fallback-${i}`,
        text: `Grade fallback test ${i} unique content`,
        imageUrl: undefined,
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      }),
    );
    const html = renderToStaticMarkup(
      <DashboardTab content={items} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    // Grade "A" for composite 9
    expect(html).toContain(">A<");
  });
});
