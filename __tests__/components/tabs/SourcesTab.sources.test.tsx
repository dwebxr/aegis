/**
 * @jest-environment jsdom
 */

/**
 * Tests for SourcesTab source list rendering, health indicators, and demo mode.
 * Each describe block has its own mock configuration for different source states.
 */

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultState, type SourceRuntimeState } from "@/lib/ingestion/sourceState";

// ─── Configurable mock state ───

let mockSources: Array<Record<string, unknown>> = [];
let mockStates: Record<string, SourceRuntimeState> = {};
let mockDemoMode = false;
let mockIsAuthenticated = true;

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({
    sources: mockSources,
    syncStatus: "idle",
    syncError: null,
    addSource: jest.fn().mockReturnValue(true),
    removeSource: jest.fn(),
    toggleSource: jest.fn(),
    updateSource: jest.fn(),
  }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: mockDemoMode }),
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

// ─── Source list rendering ───

describe("SourcesTab — source list rendering", () => {
  afterEach(() => {
    mockSources = [];
    mockStates = {};
    mockDemoMode = false;
    mockIsAuthenticated = true;
  });

  it("renders saved RSS source with label", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Example Blog", enabled: true },
    ];

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Example Blog");
    expect(html).toContain("example.com/feed.xml");
  });

  it("renders saved Nostr source with relay count", () => {
    mockSources = [
      { id: "n1", type: "nostr", label: "Nostr (2 relays)", relays: ["wss://relay.damus.io", "wss://nos.lol"], pubkeys: [], enabled: true },
    ];

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Nostr (2 relays)");
    // Relay details shown as count summary, not individual URLs
    expect(html).toContain("2 relays");
    expect(html).toContain("0 keys");
  });

  it("renders multiple sources", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Blog Feed", enabled: true },
      { id: "s2", type: "rss", feedUrl: "https://reddit.com/r/programming/.rss", label: "r/programming", enabled: true },
      { id: "s3", type: "rss", feedUrl: "https://mastodon.social/@user.rss", label: "@user@mastodon.social", enabled: false },
    ];

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Blog Feed");
    expect(html).toContain("r/programming");
    expect(html).toContain("@user@mastodon.social");
  });

  it("renders disabled source with dimmed styling", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Disabled Feed", enabled: false },
    ];

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Disabled Feed");
    // Disabled sources use text.disabled color and health indicator title="Enable"
    expect(html).toContain("Enable");
  });

  it("renders empty state when no sources saved", () => {
    mockSources = [];

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    // Should still render the heading and tabs
    expect(html).toContain("Content Sources");
    expect(html).toContain("URL");
    expect(html).toContain("RSS");
  });
});

// ─── Health status ───

describe("SourcesTab — health status display", () => {
  afterEach(() => {
    mockSources = [];
    mockStates = {};
  });

  it("shows error count and last error for errored source", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Errored Feed", enabled: true },
    ];
    mockStates["rss:https://example.com/feed.xml"] = {
      ...defaultState(),
      errorCount: 3,
      lastError: "HTTP 500",
    };

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Error (3x)");
    expect(html).toContain("HTTP 500");
  });

  it("shows rate-limited message with countdown", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Limited Feed", enabled: true },
    ];
    mockStates["rss:https://example.com/feed.xml"] = {
      ...defaultState(),
      rateLimitedUntil: Date.now() + 120_000,
    };

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).toContain("Rate limited");
    expect(html).toContain("retries automatically in");
  });

  it("prefers rate-limited over error when both present", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Both Feed", enabled: true },
    ];
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

  it("does not show rate-limited when limit has expired", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Expired Feed", enabled: true },
    ];
    mockStates["rss:https://example.com/feed.xml"] = {
      ...defaultState(),
      rateLimitedUntil: Date.now() - 1000,
    };

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    expect(html).not.toContain("Rate limited");
  });
});

// ─── Demo mode ───

describe("SourcesTab — demo mode", () => {
  afterEach(() => {
    mockDemoMode = false;
  });

  it("shows demo badge/banner in demo mode", () => {
    mockDemoMode = true;

    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} />,
    );

    // Component should indicate demo mode somehow
    expect(html.toLowerCase()).toContain("demo");
  });
});

// ─── Mobile vs desktop ───

describe("SourcesTab — responsive rendering", () => {
  afterEach(() => {
    mockSources = [];
  });

  it("renders with mobile prop", () => {
    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} mobile={true} />,
    );
    expect(html).toContain("Content Sources");
  });

  it("renders with desktop prop", () => {
    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} mobile={false} />,
    );
    expect(html).toContain("Content Sources");
  });

  it("renders sources in both modes", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Test Feed", enabled: true },
    ];

    const mobileHtml = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} mobile={true} />,
    );
    const desktopHtml = renderToStaticMarkup(
      <SourcesTab onAnalyze={noop} isAnalyzing={false} mobile={false} />,
    );

    expect(mobileHtml).toContain("Test Feed");
    expect(desktopHtml).toContain("Test Feed");
  });
});
