/**
 * @jest-environment jsdom
 */

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// jsdom doesn't have AbortSignal.timeout — polyfill it
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("signal timed out", "TimeoutError")), ms);
    return controller.signal;
  };
}

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ─── Configurable mock state ───
const mockAddSource = jest.fn().mockReturnValue(true);
const mockRemoveSource = jest.fn();
const mockToggleSource = jest.fn();
const mockUpdateSource = jest.fn();

let mockSources: Array<Record<string, unknown>> = [];
let mockIsAuthenticated = true;
let mockDemoMode = false;

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({
    sources: mockSources,
    syncStatus: "idle",
    syncError: null,
    addSource: mockAddSource,
    removeSource: mockRemoveSource,
    toggleSource: mockToggleSource,
    updateSource: mockUpdateSource,
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
    loadSourceStates: () => ({}),
    resetSourceErrors: jest.fn(),
  };
});

jest.mock("@/lib/sources/discovery", () => ({
  getSuggestions: jest.fn().mockReturnValue([]),
  dismissSuggestion: jest.fn(),
  discoverFeed: jest.fn().mockResolvedValue(null),
}));

import { SourcesTab } from "@/components/tabs/SourcesTab";

const mockFetch = jest.fn();
// Define fetch on ALL possible globals that jsdom component code might resolve to
global.fetch = mockFetch as unknown as typeof fetch;
globalThis.fetch = mockFetch as unknown as typeof fetch;
if (typeof window !== "undefined") window.fetch = mockFetch as unknown as typeof fetch;

const noop = jest.fn().mockResolvedValue({
  originality: 7, insight: 7, credibility: 7, composite: 7,
  verdict: "quality", reason: "test", scoringEngine: "heuristic",
});

beforeEach(() => {
  mockSources = [];
  mockIsAuthenticated = true;
  mockDemoMode = false;
  mockFetch.mockReset();
  mockAddSource.mockClear().mockReturnValue(true);
  mockRemoveSource.mockClear();
  mockToggleSource.mockClear();
  mockUpdateSource.mockClear();
});

describe("SourcesTab — tab switching", () => {
  it("renders URL tab by default with url input", () => {
    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    expect(screen.getByTestId("aegis-sources-url-input")).toBeTruthy();
  });

  it("switches to RSS tab", () => {
    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("RSS"));
    expect(screen.getByTestId("aegis-sources-rss-input")).toBeTruthy();
  });

  it("switches to Nostr tab", () => {
    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("Nostr"));
    expect(screen.getByPlaceholderText(/npub or hex pubkey/i)).toBeTruthy();
  });
});

describe("SourcesTab — URL extraction", () => {
  it("fetches URL on button click and renders result", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        title: "Test Article",
        content: "Article content here",
        author: "Test Author",
        source: "example.com",
      }),
    });

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);

    const input = screen.getByTestId("aegis-sources-url-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://example.com/article" } });

    await waitFor(() => {
      expect(input.value).toBe("https://example.com/article");
    });

    const btn = screen.getByTestId("aegis-sources-extract-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    // Verify fetch was called AND response data renders in the UI
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/fetch/url",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("aegis-sources-url-result")).toBeTruthy();
      expect(screen.getByText("Test Article")).toBeTruthy();
      expect(screen.getByText(/Test Author/)).toBeTruthy();
      expect(screen.getByText("Analyze This Content")).toBeTruthy();
    });
  });

  it("shows error on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Page not found" }),
    });

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);

    const input = screen.getByTestId("aegis-sources-url-input");
    fireEvent.change(input, { target: { value: "https://example.com/bad" } });
    fireEvent.click(screen.getByTestId("aegis-sources-extract-btn"));

    await waitFor(() => {
      expect(screen.getByText("Page not found")).toBeTruthy();
    });
  });

  it("shows timeout error on network timeout", async () => {
    const timeoutError = new DOMException("signal timed out", "TimeoutError");
    mockFetch.mockRejectedValueOnce(timeoutError);

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);

    const input = screen.getByTestId("aegis-sources-url-input");
    fireEvent.change(input, { target: { value: "https://slow.com" } });
    fireEvent.click(screen.getByTestId("aegis-sources-extract-btn"));

    await waitFor(() => {
      expect(screen.getByText(/timed out/i)).toBeTruthy();
    });
  });

  it("extract button is disabled when URL input is empty", () => {
    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    const btn = screen.getByTestId("aegis-sources-extract-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe("SourcesTab — RSS feed", () => {
  it("fetches RSS feed and shows results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feedTitle: "Tech Blog",
        items: [
          { title: "Post 1", content: "Content 1", link: "https://blog.com/1" },
        ],
      }),
    });

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("RSS"));

    const input = screen.getByTestId("aegis-sources-rss-input");
    fireEvent.change(input, { target: { value: "https://blog.com/feed.xml" } });
    fireEvent.click(screen.getByText("Fetch Feed"));

    await waitFor(() => {
      expect(screen.getByText(/Tech Blog/)).toBeTruthy();
    });
  });

  it("shows error on RSS fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Invalid feed format" }),
    });

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("RSS"));

    const input = screen.getByTestId("aegis-sources-rss-input");
    fireEvent.change(input, { target: { value: "https://bad.com/rss" } });
    fireEvent.click(screen.getByText("Fetch Feed"));

    await waitFor(() => {
      expect(screen.getByText("Invalid feed format")).toBeTruthy();
    });
  });

  it("saves RSS source after successful fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feedTitle: "My Blog",
        items: [{ title: "P1", content: "C1", link: "https://x.com/1" }],
      }),
    });

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("RSS"));

    const input = screen.getByTestId("aegis-sources-rss-input");
    fireEvent.change(input, { target: { value: "https://myblog.com/rss" } });
    fireEvent.click(screen.getByText("Fetch Feed"));

    await waitFor(() => {
      expect(screen.getByText(/My Blog/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Save as Source"));

    expect(mockAddSource).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rss",
        label: "My Blog",
        feedUrl: "https://myblog.com/rss",
        enabled: true,
      }),
    );
  });

  it("shows error when saving duplicate RSS source", async () => {
    mockAddSource.mockReturnValue(false);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feedTitle: "Dup Blog",
        items: [{ title: "P1", content: "C1", link: "https://x.com/1" }],
      }),
    });

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("RSS"));

    const input = screen.getByTestId("aegis-sources-rss-input");
    fireEvent.change(input, { target: { value: "https://dup.com/rss" } });
    fireEvent.click(screen.getByText("Fetch Feed"));

    await waitFor(() => {
      expect(screen.getByText(/Dup Blog/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Save as Source"));

    expect(screen.getByText("This feed is already saved")).toBeTruthy();
  });

  it("discovers feeds from website URL and renders them", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feeds: [
          { url: "https://example.com/feed.xml", title: "Main Feed", type: "rss" },
        ],
      }),
    });

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("RSS"));

    const input = screen.getByTestId("aegis-sources-rss-input");
    fireEvent.change(input, { target: { value: "https://example.com" } });

    fireEvent.click(screen.getByText(/auto-discover/i));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/fetch/discover-feed",
        expect.objectContaining({ method: "POST" }),
      );
    });

    // Verify discovered feed renders as a selectable button
    await waitFor(() => {
      expect(screen.getByText(/Main Feed/)).toBeTruthy();
    });
  });

  it("shows 'no feeds found' when discovery returns empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ feeds: [] }),
    });

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("RSS"));

    const input = screen.getByTestId("aegis-sources-rss-input");
    fireEvent.change(input, { target: { value: "https://nofeed.com" } });

    fireEvent.click(screen.getByText(/auto-discover/i));

    await waitFor(() => {
      expect(screen.getByText(/no feeds found/i)).toBeTruthy();
    });
  });
});

describe("SourcesTab — Nostr save", () => {
  it("saves Nostr source with default relay", () => {
    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("Nostr"));

    fireEvent.click(screen.getByText("Save Relay Config"));

    expect(mockAddSource).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "nostr",
        relays: ["wss://relay.damus.io"],
        enabled: true,
      }),
    );
  });

  it("shows error for invalid relay protocol", () => {
    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("Nostr"));

    const relayInput = screen.getByDisplayValue("wss://relay.damus.io");
    fireEvent.change(relayInput, { target: { value: "http://bad-relay.com" } });

    fireEvent.click(screen.getByText("Save Relay Config"));

    expect(screen.getByText(/wss:\/\/ protocol/)).toBeTruthy();
    expect(mockAddSource).not.toHaveBeenCalled();
  });
});

describe("SourcesTab — source management", () => {
  it("calls removeSource when remove button clicked", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Test Feed", enabled: true },
    ];

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);

    const removeBtn = screen.getByTitle("Remove source");
    fireEvent.click(removeBtn);

    expect(mockRemoveSource).toHaveBeenCalledWith("s1");
  });

  it("calls toggleSource when toggle button clicked", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Test Feed", enabled: true },
    ];

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);

    const toggleBtn = screen.getByTitle(/click to disable/i);
    fireEvent.click(toggleBtn);

    expect(mockToggleSource).toHaveBeenCalledWith("s1");
  });

  it("shows Enable title for disabled source", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://example.com/feed.xml", label: "Off Feed", enabled: false },
    ];

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);

    expect(screen.getByTitle("Enable")).toBeTruthy();
  });
});

describe("SourcesTab — platform badges", () => {
  it("renders YouTube source with label and remove/toggle controls", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://youtube.com/feeds/videos.xml?channel_id=X", label: "YT Channel", platform: "youtube", enabled: true },
    ];

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    expect(screen.getByText("YT Channel")).toBeTruthy();
    expect(screen.getByTitle("Remove source")).toBeTruthy();
  });

  it("renders GitHub source with label", () => {
    mockSources = [
      { id: "s1", type: "rss", feedUrl: "https://github.com/user/repo/releases.atom", label: "user/repo", platform: "github", enabled: true },
    ];

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    expect(screen.getByText("user/repo")).toBeTruthy();
  });
});

describe("SourcesTab — network error on RSS", () => {
  it("shows network error message", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));

    render(<SourcesTab onAnalyze={noop} isAnalyzing={false} />);
    fireEvent.click(screen.getByText("RSS"));

    const input = screen.getByTestId("aegis-sources-rss-input");
    fireEvent.change(input, { target: { value: "https://offline.com/rss" } });
    fireEvent.click(screen.getByText("Fetch Feed"));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeTruthy();
    });
  });
});
