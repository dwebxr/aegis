/**
 * @jest-environment jsdom
 */
/**
 * SourceContext — CRUD integration tests.
 * Tests addSource (with duplicate detection), removeSource, toggleSource,
 * updateSource, and getSchedulerSources via the real provider.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import type { SavedSource } from "@/lib/types/sources";

/* ── Mocks ── */
let mockAuth = { isAuthenticated: false, identity: null as unknown, principalText: "" };
let mockDemo = { isDemoMode: false };
const mockAddNotification = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));
jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => mockDemo,
}));
jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: mockAddNotification, removeNotification: jest.fn() }),
}));
jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn(),
}));

// Mock the storage functions to use an in-memory store
const sourceStore = new Map<string, SavedSource[]>();
jest.mock("@/lib/sources/storage", () => ({
  loadSources: (pt: string) => sourceStore.get(pt) ?? [],
  saveSources: (pt: string, sources: SavedSource[]) => { sourceStore.set(pt, sources); },
  inferPlatform: () => undefined,
}));
jest.mock("@/lib/ingestion/sourceState", () => ({
  getSourceKey: (type: string, config: Record<string, string>) => `${type}:${JSON.stringify(config)}`,
  resetSourceErrors: jest.fn(),
}));

import { SourceProvider, useSources } from "@/contexts/SourceContext";

/* ── Test consumer that exposes context via data attributes and buttons ── */
let capturedSchedulerSources: ReturnType<ReturnType<typeof useSources>["getSchedulerSources"]> = [];

function Consumer() {
  const ctx = useSources();
  capturedSchedulerSources = ctx.getSchedulerSources();
  return (
    <div>
      <span data-testid="count">{ctx.sources.length}</span>
      <span data-testid="sync">{ctx.syncStatus}</span>
      <span data-testid="ids">{ctx.sources.map(s => s.id).join(",")}</span>
      <span data-testid="labels">{ctx.sources.map(s => s.label).join(",")}</span>
      <span data-testid="enabled">{ctx.sources.map(s => String(s.enabled)).join(",")}</span>
      <button data-testid="add-rss" onClick={() => ctx.addSource({ type: "rss", label: "RSS Feed", enabled: true, feedUrl: "https://example.com/feed.xml" })} />
      <button data-testid="add-rss-dup" onClick={() => ctx.addSource({ type: "rss", label: "Duplicate", enabled: true, feedUrl: "https://example.com/feed.xml" })} />
      <button data-testid="add-nostr" onClick={() => ctx.addSource({ type: "nostr", label: "Nostr", enabled: true, relays: ["wss://relay.example.com"], pubkeys: ["abc123"] })} />
      <button data-testid="add-farcaster" onClick={() => ctx.addSource({ type: "farcaster", label: "FC User", enabled: true, fid: 12345, username: "alice" })} />
      <button data-testid="add-farcaster-dup" onClick={() => ctx.addSource({ type: "farcaster", label: "FC Dup", enabled: true, fid: 12345, username: "alice2" })} />
    </div>
  );
}

function renderWithProvider() {
  return render(<SourceProvider><Consumer /></SourceProvider>);
}

beforeEach(() => {
  mockAuth = { isAuthenticated: false, identity: null, principalText: "" };
  mockDemo = { isDemoMode: false };
  mockAddNotification.mockClear();
  sourceStore.clear();
  capturedSchedulerSources = [];
});

describe("SourceContext — addSource", () => {
  it("adds an RSS source", () => {
    renderWithProvider();
    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => { screen.getByTestId("add-rss").click(); });
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByTestId("labels").textContent).toBe("RSS Feed");
  });

  it("rejects duplicate RSS source with same feedUrl", () => {
    renderWithProvider();
    let result: boolean | undefined;

    act(() => { screen.getByTestId("add-rss").click(); });
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => { screen.getByTestId("add-rss-dup").click(); });
    // Should still be 1 — duplicate rejected
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("adds nostr and farcaster sources", () => {
    renderWithProvider();
    act(() => { screen.getByTestId("add-nostr").click(); });
    act(() => { screen.getByTestId("add-farcaster").click(); });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("rejects duplicate farcaster source with same fid", () => {
    renderWithProvider();
    act(() => { screen.getByTestId("add-farcaster").click(); });
    act(() => { screen.getByTestId("add-farcaster-dup").click(); });
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("blocks addSource in demo mode (count unchanged after attempt)", () => {
    mockDemo = { isDemoMode: true };
    renderWithProvider();
    const before = screen.getByTestId("count").textContent;
    act(() => { screen.getByTestId("add-rss").click(); });
    // Count should not increase — demo sources may be pre-loaded but addSource is a no-op
    expect(screen.getByTestId("count").textContent).toBe(before);
  });
});

describe("SourceContext — removeSource", () => {
  function ConsumerWithRemove() {
    const ctx = useSources();
    return (
      <div>
        <span data-testid="count">{ctx.sources.length}</span>
        <span data-testid="ids">{ctx.sources.map(s => s.id).join(",")}</span>
        <button data-testid="add" onClick={() => ctx.addSource({ type: "rss", label: "Feed", enabled: true, feedUrl: "https://a.com/feed" })} />
        <button data-testid="remove-first" onClick={() => {
          const first = ctx.sources[0];
          if (first) ctx.removeSource(first.id);
        }} />
      </div>
    );
  }

  it("removes a source by id", () => {
    render(<SourceProvider><ConsumerWithRemove /></SourceProvider>);
    act(() => { screen.getByTestId("add").click(); });
    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => { screen.getByTestId("remove-first").click(); });
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("blocks removeSource in demo mode (count unchanged after attempt)", () => {
    mockDemo = { isDemoMode: true };
    render(<SourceProvider><ConsumerWithRemove /></SourceProvider>);
    const before = screen.getByTestId("count").textContent;
    act(() => { screen.getByTestId("remove-first").click(); });
    // Count should not decrease — removeSource is a no-op in demo
    expect(screen.getByTestId("count").textContent).toBe(before);
  });
});

describe("SourceContext — toggleSource", () => {
  function ConsumerWithToggle() {
    const ctx = useSources();
    return (
      <div>
        <span data-testid="enabled">{ctx.sources.map(s => String(s.enabled)).join(",")}</span>
        <button data-testid="add" onClick={() => ctx.addSource({ type: "rss", label: "Feed", enabled: true, feedUrl: "https://b.com/feed" })} />
        <button data-testid="toggle-first" onClick={() => {
          const first = ctx.sources[0];
          if (first) ctx.toggleSource(first.id);
        }} />
      </div>
    );
  }

  it("toggles source enabled state", () => {
    render(<SourceProvider><ConsumerWithToggle /></SourceProvider>);
    act(() => { screen.getByTestId("add").click(); });
    expect(screen.getByTestId("enabled").textContent).toBe("true");

    act(() => { screen.getByTestId("toggle-first").click(); });
    expect(screen.getByTestId("enabled").textContent).toBe("false");

    act(() => { screen.getByTestId("toggle-first").click(); });
    expect(screen.getByTestId("enabled").textContent).toBe("true");
  });
});

describe("SourceContext — updateSource", () => {
  function ConsumerWithUpdate() {
    const ctx = useSources();
    return (
      <div>
        <span data-testid="labels">{ctx.sources.map(s => s.label).join(",")}</span>
        <button data-testid="add" onClick={() => ctx.addSource({ type: "rss", label: "Old", enabled: true, feedUrl: "https://c.com/feed" })} />
        <button data-testid="update-first" onClick={() => {
          const first = ctx.sources[0];
          if (first) ctx.updateSource(first.id, { label: "New" });
        }} />
      </div>
    );
  }

  it("updates source label", () => {
    render(<SourceProvider><ConsumerWithUpdate /></SourceProvider>);
    act(() => { screen.getByTestId("add").click(); });
    expect(screen.getByTestId("labels").textContent).toBe("Old");

    act(() => { screen.getByTestId("update-first").click(); });
    expect(screen.getByTestId("labels").textContent).toBe("New");
  });
});

describe("SourceContext — getSchedulerSources", () => {
  it("maps enabled RSS source to scheduler format", () => {
    renderWithProvider();
    act(() => { screen.getByTestId("add-rss").click(); });
    expect(capturedSchedulerSources).toHaveLength(1);
    expect(capturedSchedulerSources[0].type).toBe("rss");
    expect(capturedSchedulerSources[0].config.feedUrl).toBe("https://example.com/feed.xml");
    expect(capturedSchedulerSources[0].enabled).toBe(true);
  });

  it("maps enabled nostr source to scheduler format", () => {
    renderWithProvider();
    act(() => { screen.getByTestId("add-nostr").click(); });
    expect(capturedSchedulerSources).toHaveLength(1);
    expect(capturedSchedulerSources[0].type).toBe("nostr");
    expect(capturedSchedulerSources[0].config.relays).toBe("wss://relay.example.com");
    expect(capturedSchedulerSources[0].config.pubkeys).toBe("abc123");
  });

  it("maps enabled farcaster source to scheduler format", () => {
    renderWithProvider();
    act(() => { screen.getByTestId("add-farcaster").click(); });
    expect(capturedSchedulerSources).toHaveLength(1);
    expect(capturedSchedulerSources[0].type).toBe("farcaster");
    expect(capturedSchedulerSources[0].config.fid).toBe("12345");
    expect(capturedSchedulerSources[0].config.username).toBe("alice");
  });

  it("excludes disabled sources from scheduler", () => {
    function ConsumerToggleScheduler() {
      const ctx = useSources();
      capturedSchedulerSources = ctx.getSchedulerSources();
      return (
        <div>
          <button data-testid="add" onClick={() => ctx.addSource({ type: "rss", label: "Feed", enabled: true, feedUrl: "https://d.com/feed" })} />
          <button data-testid="toggle" onClick={() => {
            const first = ctx.sources[0];
            if (first) ctx.toggleSource(first.id);
          }} />
        </div>
      );
    }
    render(<SourceProvider><ConsumerToggleScheduler /></SourceProvider>);
    act(() => { screen.getByTestId("add").click(); });
    expect(capturedSchedulerSources).toHaveLength(1);

    act(() => { screen.getByTestId("toggle").click(); });
    expect(capturedSchedulerSources).toHaveLength(0);
  });

  it("returns empty array when no sources", () => {
    renderWithProvider();
    expect(capturedSchedulerSources).toEqual([]);
  });
});
