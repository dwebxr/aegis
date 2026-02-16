import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { SerendipityItem } from "@/lib/filtering/serendipity";

jest.mock("@/components/ui/ContentCard", () => ({
  ContentCard: () => <div data-testid="content-card" />,
}));

jest.mock("@/components/ui/ShareBriefingModal", () => ({
  ShareBriefingModal: () => null,
}));

jest.mock("@/components/filtering/SerendipityBadge", () => ({
  SerendipityBadge: () => <span>badge</span>,
}));

jest.mock("@/contexts/ContentContext", () => ({
  useContent: () => ({ syncBriefing: jest.fn() }),
}));

const { BriefingTab } = require("@/components/tabs/BriefingTab");

const makeItem = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  id: "test-1",
  owner: "user",
  author: "author",
  avatar: "",
  text: "Test content",
  source: "rss",
  scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
  verdict: "quality",
  reason: "good",
  createdAt: Date.now(),
  validated: true,
  flagged: false,
  timestamp: new Date().toISOString(),
  ...overrides,
});

const defaultProfile: UserPreferenceProfile = {
  version: 1,
  principalId: "test-principal",
  topicAffinities: {},
  authorTrust: {},
  calibration: { qualityThreshold: 3 },
  recentTopics: [],
  totalValidated: 5,
  totalFlagged: 2,
  lastUpdated: Date.now(),
};

const noop = () => {};

describe("BriefingTab — Discovery source links", () => {
  it("renders source link with hostname for https URL", () => {
    const discoveries: SerendipityItem[] = [{
      item: makeItem({ id: "d1", sourceUrl: "https://example.com/article/123" }),
      wotScore: 5,
      qualityComposite: 7,
      discoveryType: "emerging_topic",
      reason: "Interesting topic",
    }];

    const html = renderToStaticMarkup(
      <BriefingTab
        content={[]}
        profile={defaultProfile}
        onValidate={noop}
        onFlag={noop}
        discoveries={discoveries}
      />,
    );

    expect(html).toContain("example.com");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("\u2197"); // ↗ arrow
  });

  it("does NOT render link for javascript: protocol (XSS prevention)", () => {
    const discoveries: SerendipityItem[] = [{
      item: makeItem({ id: "d2", sourceUrl: "javascript:alert(1)" }),
      wotScore: 5,
      qualityComposite: 7,
      discoveryType: "out_of_network",
      reason: "Test reason",
    }];

    const html = renderToStaticMarkup(
      <BriefingTab
        content={[]}
        profile={defaultProfile}
        onValidate={noop}
        onFlag={noop}
        discoveries={discoveries}
      />,
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });

  it("does NOT render link for data: protocol", () => {
    const discoveries: SerendipityItem[] = [{
      item: makeItem({ id: "d3", sourceUrl: "data:text/html,<script>alert(1)</script>" }),
      wotScore: 5,
      qualityComposite: 7,
      discoveryType: "cross_language",
      reason: "Data URI test",
    }];

    const html = renderToStaticMarkup(
      <BriefingTab
        content={[]}
        profile={defaultProfile}
        onValidate={noop}
        onFlag={noop}
        discoveries={discoveries}
      />,
    );

    expect(html).not.toContain("data:text");
    expect(html).not.toContain("<a ");
  });

  it("renders link for http:// URL", () => {
    const discoveries: SerendipityItem[] = [{
      item: makeItem({ id: "d4", sourceUrl: "http://legacy-site.org/page" }),
      wotScore: 5,
      qualityComposite: 7,
      discoveryType: "emerging_topic",
      reason: "HTTP test",
    }];

    const html = renderToStaticMarkup(
      <BriefingTab
        content={[]}
        profile={defaultProfile}
        onValidate={noop}
        onFlag={noop}
        discoveries={discoveries}
      />,
    );

    expect(html).toContain("legacy-site.org");
    expect(html).toContain("http://legacy-site.org/page");
  });

  it("does NOT render link when sourceUrl is absent", () => {
    const discoveries: SerendipityItem[] = [{
      item: makeItem({ id: "d5", sourceUrl: undefined }),
      wotScore: 5,
      qualityComposite: 7,
      discoveryType: "emerging_topic",
      reason: "No URL",
    }];

    const html = renderToStaticMarkup(
      <BriefingTab
        content={[]}
        profile={defaultProfile}
        onValidate={noop}
        onFlag={noop}
        discoveries={discoveries}
      />,
    );

    // Should have the discovery reason but no <a> link
    expect(html).toContain("No URL");
    expect(html).not.toMatch(/<a [^>]*href/);
  });
});
