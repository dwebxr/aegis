/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
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
    addSource: jest.fn(),
    removeSource: mockRemoveSource,
    toggleSource: mockToggleSource,
    updateSource: jest.fn(),
    getSchedulerSources: () => [],
  }),
}));

jest.mock("@/lib/ingestion/sourceState", () => {
  const actual = jest.requireActual("@/lib/ingestion/sourceState");
  return {
    ...actual,
    loadSourceStates: () => mockRuntime,
  };
});

import { SourceQualitySection } from "@/components/analytics/SourceQualitySection";

function makeSource(over: Partial<SavedSource> = {}): SavedSource {
  return {
    id: over.id ?? "s-1",
    type: over.type ?? "rss",
    label: over.label ?? "Source 1",
    enabled: over.enabled ?? true,
    feedUrl: over.feedUrl ?? "https://example.com/feed",
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

describe("SourceQualitySection — empty + insufficient", () => {
  it("renders nothing when no sources are configured", () => {
    const { container } = render(<SourceQualitySection content={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the not-enough-data message when every source is below MIN_SAMPLE_SIZE", () => {
    mockSources = [makeSource({ id: "s1" })];
    mockContent = [makeItem({ source: "rss", sourceUrl: "https://example.com/a", savedSourceId: "s1" })];
    render(<SourceQualitySection content={mockContent} />);
    expect(screen.getByText(/Not enough data yet/)).toBeInTheDocument();
    expect(screen.getByTestId("aegis-source-quality-window-30d")).toBeInTheDocument();
  });
});

describe("SourceQualitySection — top / bottom split", () => {
  it("orders ranked sources by qualityYield and shows action chips for mute/remove", () => {
    mockSources = [
      makeSource({ id: "good", label: "Good Source", feedUrl: "https://good.com/feed" }),
      makeSource({ id: "bad", label: "Bad Source", feedUrl: "https://bad.com/feed" }),
    ];
    const goodItems: ContentItem[] = Array.from({ length: MIN_SAMPLE_SIZE }, (_, i) => makeItem({
      id: `g${i}`,
      sourceUrl: `https://good.com/${i}`,
      savedSourceId: "good",
      verdict: "quality",
      createdAt: NOW - 1000,
    }));
    const badItems: ContentItem[] = Array.from({ length: MIN_SAMPLE_SIZE }, (_, i) => makeItem({
      id: `b${i}`,
      sourceUrl: `https://bad.com/${i}`,
      savedSourceId: "bad",
      verdict: i < MIN_SAMPLE_SIZE - 2 ? "slop" : "quality",
      createdAt: NOW - 1000,
    }));
    mockContent = [...goodItems, ...badItems];

    render(<SourceQualitySection content={mockContent} />);

    expect(screen.getByTestId("aegis-source-quality-row-good")).toBeInTheDocument();
    expect(screen.getByTestId("aegis-source-quality-row-bad")).toBeInTheDocument();

    expect(screen.getByText("Top performers")).toBeInTheDocument();

    expect(screen.getByTestId("aegis-source-quality-badge-keep")).toBeInTheDocument();
    expect(screen.getByTestId("aegis-source-quality-badge-mute")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("aegis-source-quality-mute"));
    expect(mockToggleSource).toHaveBeenCalledWith("bad");
  });

  it("splits into Top and Bottom sections when ranked sources exceed TOP_N", () => {
    mockSources = Array.from({ length: 7 }, (_, i) => makeSource({
      id: `s${i}`,
      label: `Source ${i}`,
      feedUrl: `https://s${i}.example.com/feed`,
    }));
    const items: ContentItem[] = [];
    mockSources.forEach((src, idx) => {
      const goodCount = idx < 4 ? MIN_SAMPLE_SIZE : 2;
      const slopCount = idx < 4 ? 1 : MIN_SAMPLE_SIZE - 2;
      for (let i = 0; i < goodCount; i++) {
        items.push(makeItem({
          id: `${src.id}-q${i}`,
          sourceUrl: `https://s${idx}.example.com/q${i}`,
          savedSourceId: src.id,
          verdict: "quality",
          createdAt: NOW - 1000,
        }));
      }
      for (let i = 0; i < slopCount; i++) {
        items.push(makeItem({
          id: `${src.id}-s${i}`,
          sourceUrl: `https://s${idx}.example.com/s${i}`,
          savedSourceId: src.id,
          verdict: "slop",
          createdAt: NOW - 1000,
        }));
      }
    });
    mockContent = items;

    render(<SourceQualitySection content={mockContent} />);

    expect(screen.getByText("Top performers")).toBeInTheDocument();
    expect(screen.getByText("Bottom performers")).toBeInTheDocument();
  });

  it("shows Remove chip when source is disabled and stale, then invokes removeSource", () => {
    mockSources = [makeSource({ id: "dead", enabled: false, label: "Dead", feedUrl: "https://dead.com/feed" })];
    mockRuntime = {
      "rss:https://dead.com/feed": {
        ...defaultState(),
        errorCount: 10,
        lastFetchedAt: NOW - STALE_MS - 1000,
      },
    };
    render(<SourceQualitySection content={[]} />);
    const removeBtn = screen.getByTestId("aegis-source-quality-remove");
    fireEvent.click(removeBtn);
    expect(mockRemoveSource).toHaveBeenCalledWith("dead");
  });
});

describe("SourceQualitySection — time window toggle", () => {
  it("changes the visible recommendation when switching from 30d to 7d", () => {
    mockSources = [makeSource({ id: "s1", label: "Recently Improved", feedUrl: "https://example.com/feed" })];
    const oldSlop: ContentItem[] = Array.from({ length: 8 }, (_, i) => makeItem({
      id: `old${i}`,
      sourceUrl: `https://example.com/old${i}`,
      savedSourceId: "s1",
      verdict: "slop",
      createdAt: NOW - 20 * 86_400_000,
    }));
    const newQuality: ContentItem[] = Array.from({ length: 12 }, (_, i) => makeItem({
      id: `new${i}`,
      sourceUrl: `https://example.com/new${i}`,
      savedSourceId: "s1",
      verdict: "quality",
      createdAt: NOW - 1 * 86_400_000,
    }));
    mockContent = [...oldSlop, ...newQuality];

    render(<SourceQualitySection content={mockContent} />);

    expect(screen.queryByTestId("aegis-source-quality-badge-keep")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("aegis-source-quality-window-7d"));
    expect(screen.queryByTestId("aegis-source-quality-badge-keep")).toBeInTheDocument();
  });
});

describe("SourceQualitySection — unattributed", () => {
  it("renders D2A / Manual / Shared URL cards when content has unattributed entries", () => {
    mockSources = [makeSource({ id: "s1" })];
    mockContent = [
      makeItem({ id: "m1", source: "manual", verdict: "quality" }),
      makeItem({ id: "u1", source: "url", verdict: "slop" }),
      makeItem({ id: "d1", source: "manual", reason: "Received via D2A from peer-abc", verdict: "quality" }),
    ];
    render(<SourceQualitySection content={mockContent} />);
    expect(screen.getByTestId("aegis-source-quality-unattributed-d2a")).toBeInTheDocument();
    expect(screen.getByTestId("aegis-source-quality-unattributed-manual")).toBeInTheDocument();
    expect(screen.getByTestId("aegis-source-quality-unattributed-shared-url")).toBeInTheDocument();
  });
});
