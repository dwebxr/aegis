/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("signal timed out", "TimeoutError")), ms);
    return controller.signal;
  };
}

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ContentItem } from "@/lib/types/content";
import type { SavedSource } from "@/lib/types/sources";
import type { SourceRuntimeState } from "@/lib/ingestion/sourceState";
import { defaultState } from "@/lib/ingestion/sourceState";
import { MIN_SAMPLE_SIZE, STALE_MS } from "@/lib/dashboard/sourceQuality";

const NOW = 1_750_000_000_000;

let mockSources: SavedSource[] = [];
const mockToggleSource = jest.fn();
const mockRemoveSource = jest.fn();
let mockContent: ContentItem[] = [];
let mockRuntime: Record<string, SourceRuntimeState> = {};

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({
    sources: mockSources,
    syncStatus: "idle",
    syncError: "",
    addSource: jest.fn().mockReturnValue(true),
    removeSource: mockRemoveSource,
    toggleSource: mockToggleSource,
    updateSource: jest.fn(),
  }),
}));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));
jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: false }),
}));
jest.mock("@/contexts/ContentContext", () => ({
  useContent: () => ({ content: mockContent }),
}));
jest.mock("@/lib/ingestion/sourceState", () => {
  const actual = jest.requireActual("@/lib/ingestion/sourceState");
  return {
    ...actual,
    loadSourceStates: () => mockRuntime,
    resetSourceErrors: jest.fn(),
  };
});
jest.mock("@/lib/sources/discovery", () => ({
  getSuggestions: jest.fn().mockReturnValue([]),
  dismissSuggestion: jest.fn(),
  discoverFeed: jest.fn().mockResolvedValue(null),
}));

import { SourcesTab } from "@/components/tabs/SourcesTab";

function makeSource(over: Partial<SavedSource> = {}): SavedSource {
  return {
    id: over.id ?? "src-1",
    type: over.type ?? "rss",
    label: over.label ?? "Quality Source",
    enabled: over.enabled ?? true,
    feedUrl: over.feedUrl ?? "https://quality.com/feed",
    createdAt: NOW - 86_400_000,
    ...over,
  };
}

function makeItem(over: Partial<ContentItem> = {}): ContentItem {
  return {
    id: over.id ?? `i-${Math.random()}`,
    owner: "",
    author: "",
    avatar: "",
    text: "lorem",
    source: "rss",
    sourceUrl: undefined,
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "",
    createdAt: NOW - 60_000,
    validated: false,
    flagged: false,
    timestamp: "1m ago",
    ...over,
  };
}

const noopAnalyze = jest.fn().mockResolvedValue({
  originality: 7, insight: 7, credibility: 7, composite: 7,
  verdict: "quality", reason: "test", scoringEngine: "heuristic",
});

beforeEach(() => {
  mockSources = [];
  mockContent = [];
  mockRuntime = {};
  mockToggleSource.mockClear();
  mockRemoveSource.mockClear();
  jest.useFakeTimers().setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("SourcesTab — per-row quality badge", () => {
  it("shows Healthy badge for keep-quality source", () => {
    mockSources = [makeSource({ id: "s1" })];
    mockContent = Array.from({ length: MIN_SAMPLE_SIZE }, (_, i) => makeItem({
      id: `q${i}`,
      sourceUrl: `https://quality.com/${i}`,
      savedSourceId: "s1",
      verdict: "quality",
    }));

    render(<SourcesTab onAnalyze={noopAnalyze} isAnalyzing={false} />);

    const badge = screen.getByTestId("aegis-sources-quality-badge-s1");
    expect(badge).toHaveTextContent("Healthy");
  });

  it("shows Noisy badge and Mute chip when slopRate exceeds threshold", () => {
    mockSources = [makeSource({ id: "s1" })];
    mockContent = Array.from({ length: MIN_SAMPLE_SIZE }, (_, i) => makeItem({
      id: `b${i}`,
      sourceUrl: `https://quality.com/${i}`,
      savedSourceId: "s1",
      verdict: i < 6 ? "slop" : "quality",
    }));

    render(<SourcesTab onAnalyze={noopAnalyze} isAnalyzing={false} />);

    expect(screen.getByTestId("aegis-sources-quality-badge-s1")).toHaveTextContent("Noisy");
    fireEvent.click(screen.getByTestId("aegis-sources-mute-s1"));
    expect(mockToggleSource).toHaveBeenCalledWith("s1");
  });

  it("shows Learning badge for sources below MIN_SAMPLE_SIZE", () => {
    mockSources = [makeSource({ id: "s1" })];
    mockContent = [makeItem({ id: "q1", sourceUrl: "https://quality.com/x", savedSourceId: "s1" })];

    render(<SourcesTab onAnalyze={noopAnalyze} isAnalyzing={false} />);
    expect(screen.getByTestId("aegis-sources-quality-badge-s1")).toHaveTextContent("Learning");
    expect(screen.queryByTestId("aegis-sources-mute-s1")).not.toBeInTheDocument();
  });

  it("shows Stale badge when last fetch older than STALE_MS", () => {
    mockSources = [makeSource({ id: "s1" })];
    mockRuntime = {
      "rss:https://quality.com/feed": { ...defaultState(), lastFetchedAt: NOW - STALE_MS - 1000 },
    };
    render(<SourcesTab onAnalyze={noopAnalyze} isAnalyzing={false} />);
    expect(screen.getByTestId("aegis-sources-quality-badge-s1")).toHaveTextContent("Stale");
  });

  it("shows Issue badge when source is auto-disabled and Remove chip when also stale", () => {
    mockSources = [makeSource({ id: "s1", enabled: false })];
    mockRuntime = {
      "rss:https://quality.com/feed": {
        ...defaultState(),
        errorCount: 10,
        lastFetchedAt: NOW - STALE_MS - 1000,
      },
    };
    render(<SourcesTab onAnalyze={noopAnalyze} isAnalyzing={false} />);
    expect(screen.getByTestId("aegis-sources-quality-badge-s1")).toHaveTextContent(/Issue|Stale/);

    fireEvent.click(screen.getByTestId("aegis-sources-remove-suggested-s1"));
    expect(mockRemoveSource).toHaveBeenCalledWith("s1");
  });
});
