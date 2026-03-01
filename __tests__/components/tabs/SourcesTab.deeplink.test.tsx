/**
 * @jest-environment jsdom
 */

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

import { isTimeout } from "@/lib/utils/errors";
const mockFetchResponse = {
  title: "Test Page",
  author: "Author",
  content: "Article content here",
  url: "https://example.com",
};

global.fetch = jest.fn().mockImplementation(async () => ({
  ok: true,
  json: async () => mockFetchResponse,
})) as jest.Mock;

if (!AbortSignal.timeout) {
  (AbortSignal as unknown as Record<string, unknown>).timeout = () => new AbortController().signal;
}

let mockSources: Array<Record<string, unknown>> = [];
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
    loadSourceStates: () => ({}),
    resetSourceErrors: jest.fn(),
  };
});

jest.mock("@/lib/sources/discovery", () => ({
  getSuggestions: () => [],
  dismissSuggestion: jest.fn(),
  discoverFeed: jest.fn(),
}));

import { SourcesTab } from "@/components/tabs/SourcesTab";

describe("SourcesTab — SSR rendering", () => {
  beforeEach(() => {
    mockSources = [];
    mockDemoMode = false;
    mockIsAuthenticated = true;
    (global.fetch as jest.Mock).mockClear();
  });

  it("renders without initialUrl (normal mode)", () => {
    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={jest.fn()} isAnalyzing={false} />,
    );
    expect(html).toContain("Content Sources");
  });

  it("renders the Extract URL section with input and button", () => {
    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={jest.fn()} isAnalyzing={false} />,
    );
    expect(html).toContain("Extract");
    expect(html).toContain("Article URL");
    expect(html).toContain("placeholder");
  });

  it("renders source type tabs (URL, RSS, Twitter, Nostr)", () => {
    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={jest.fn()} isAnalyzing={false} />,
    );
    expect(html).toContain("URL");
    expect(html).toContain("RSS");
    expect(html).toContain("Nostr");
  });

  it("renders mobile layout", () => {
    const html = renderToStaticMarkup(
      <SourcesTab onAnalyze={jest.fn()} isAnalyzing={false} mobile={true} />,
    );
    expect(html).toContain("Content Sources");
  });
});

function mountSourcesTab(initialUrl?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  let root: ReturnType<typeof createRoot>;
  act(() => {
    root = createRoot(container);
    root.render(
      <SourcesTab
        onAnalyze={jest.fn()}
        isAnalyzing={false}
        initialUrl={initialUrl}
      />,
    );
  });

  return {
    container,
    cleanup: () => {
      act(() => root!.unmount());
      container.remove();
    },
  };
}

describe("SourcesTab — initialUrl triggers real fetchUrl", () => {
  beforeEach(() => {
    mockSources = [];
    mockDemoMode = false;
    mockIsAuthenticated = true;
    (global.fetch as jest.Mock).mockClear();
  });

  it("initialUrl triggers fetch(/api/fetch/url) with correct URL", () => {
    const mount = mountSourcesTab("https://example.com/article");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/fetch/url",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/article" }),
      }),
    );
    mount.cleanup();
  });

  it("no initialUrl → fetch NOT called on mount", () => {
    const mount = mountSourcesTab(undefined);
    expect(global.fetch).not.toHaveBeenCalled();
    mount.cleanup();
  });

  it("initialUrl populates the URL input field", () => {
    const mount = mountSourcesTab("https://example.com/test");
    const input = mount.container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("https://example.com/test");
    mount.cleanup();
  });

  it("initialUrl consumed exactly once (not duplicated)", () => {
    const mount = mountSourcesTab("https://example.com/once");
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("/api/fetch/url");
    const body = JSON.parse(calls[0][1].body);
    expect(body.url).toBe("https://example.com/once");
    mount.cleanup();
  });

  it("empty string initialUrl does NOT trigger fetch", () => {
    const mount = mountSourcesTab("");
    expect(global.fetch).not.toHaveBeenCalled();
    mount.cleanup();
  });
});

describe("isTimeout — from lib/utils/errors", () => {
  it("identifies DOMException TimeoutError", () => {
    const err = new DOMException("The operation timed out", "TimeoutError");
    expect(isTimeout(err)).toBe(true);
  });

  it("rejects regular Error", () => {
    expect(isTimeout(new Error("timeout"))).toBe(false);
  });

  it("rejects DOMException with different name", () => {
    const err = new DOMException("Abort", "AbortError");
    expect(isTimeout(err)).toBe(false);
  });

  it("rejects null", () => {
    expect(isTimeout(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isTimeout(undefined)).toBe(false);
  });

  it("rejects string", () => {
    expect(isTimeout("TimeoutError")).toBe(false);
  });

  it("rejects plain object mimicking DOMException", () => {
    expect(isTimeout({ name: "TimeoutError" })).toBe(false);
  });
});
