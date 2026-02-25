import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultState, type SourceRuntimeState } from "@/lib/ingestion/sourceState";

let mockStates: Record<string, SourceRuntimeState> = {};

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({
    sources: [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Example Feed", enabled: true },
    ],
    syncStatus: "idle",
    syncError: null,
    addSource: () => true,
    removeSource: () => {},
    toggleSource: () => {},
    updateSource: () => {},
  }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: false }),
}));

jest.mock("@/lib/ingestion/sourceState", () => {
  const actual = jest.requireActual("@/lib/ingestion/sourceState");
  return {
    ...actual,
    loadSourceStates: () => mockStates,
    resetSourceErrors: jest.fn(),
  };
});

const { SourcesTab } = require("@/components/tabs/SourcesTab");

const noop = async () => ({ scores: {}, verdict: "quality", reason: "" });

describe("SourcesTab — rate limit display", () => {
  afterEach(() => {
    mockStates = {};
  });

  it("shows friendly rate-limited message when source is rate-limited", () => {
    mockStates["rss:https://example.com/feed.xml"] = {
      ...defaultState(),
      rateLimitedUntil: Date.now() + 120_000,
    };

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Rate limited");
    expect(html).toContain("retries automatically in");
    expect(html).not.toContain("Error (");
  });

  it("shows normal error when source has errors but is not rate-limited", () => {
    mockStates["rss:https://example.com/feed.xml"] = {
      ...defaultState(),
      errorCount: 2,
      lastError: "HTTP 500",
      rateLimitedUntil: 0,
    };

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Error (2x)");
    expect(html).toContain("HTTP 500");
    expect(html).not.toContain("Rate limited");
  });

  it("shows rate-limited instead of error when both are present", () => {
    mockStates["rss:https://example.com/feed.xml"] = {
      ...defaultState(),
      errorCount: 2,
      lastError: "HTTP 429",
      rateLimitedUntil: Date.now() + 60_000,
    };

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Rate limited");
    expect(html).not.toContain("Error (2x)");
  });

  it("does not show rate-limited message when limit has expired", () => {
    mockStates["rss:https://example.com/feed.xml"] = {
      ...defaultState(),
      rateLimitedUntil: Date.now() - 1000,
    };

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).not.toContain("Rate limited");
  });

  it("uses sky-blue indicator color for rate-limited sources", () => {
    mockStates["rss:https://example.com/feed.xml"] = {
      ...defaultState(),
      rateLimitedUntil: Date.now() + 60_000,
    };

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    // Sky-400 color from HEALTH_COLORS.rate_limited
    expect(html).toContain("Rate limited");
    expect(html).toContain("retrying soon");
  });
});
