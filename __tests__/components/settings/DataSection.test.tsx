/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataSection } from "@/components/settings/DataSection";
import type { ContentItem } from "@/lib/types/content";

let mockIsAuthenticated = true;
let mockPrincipalText = "test-principal";
const mockAddNotification = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    principalText: mockPrincipalText,
  }),
}));

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: mockAddNotification }),
}));

// Mock export functions to avoid download triggers
const mockExportCSV = jest.fn();
const mockExportJSON = jest.fn();
jest.mock("@/lib/utils/export", () => ({
  exportContentCSV: (...args: unknown[]) => mockExportCSV(...args),
  exportContentJSON: (...args: unknown[]) => mockExportJSON(...args),
}));

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    owner: "owner", author: "Author", avatar: "A", text: "text",
    source: "rss", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality", reason: "reason", createdAt: Date.now(),
    validated: false, flagged: false, timestamp: "now", topics: ["t"],
    ...overrides,
  };
}

beforeEach(() => {
  mockIsAuthenticated = true;
  mockPrincipalText = "test-principal";
  mockAddNotification.mockClear();
  mockExportCSV.mockClear();
  mockExportJSON.mockClear();
  localStorage.clear();
});

describe("DataSection — Export", () => {
  it("shows export buttons when content exists", () => {
    const html = renderToStaticMarkup(<DataSection content={[makeItem()]} />);
    expect(html).toContain("Export CSV");
    expect(html).toContain("Export JSON");
  });

  it("shows empty state when no content", () => {
    const html = renderToStaticMarkup(<DataSection content={[]} />);
    expect(html).toContain("No content to export yet");
    expect(html).not.toContain("Export CSV");
  });

  it("shows scope selectors: Period and Content", () => {
    const html = renderToStaticMarkup(<DataSection content={[makeItem()]} />);
    expect(html).toContain("Period");
    expect(html).toContain("Today");
    expect(html).toContain("7d");
    expect(html).toContain("30d");
    expect(html).toContain("All");
    expect(html).toContain("Quality only");
  });

  it("calls exportContentCSV with scope when Export CSV clicked", () => {
    const items = [makeItem()];
    render(<DataSection content={items} />);
    fireEvent.click(screen.getByText("Export CSV"));
    expect(mockExportCSV).toHaveBeenCalledWith(items, { period: "all", type: "all" });
  });

  it("calls exportContentJSON with scope when Export JSON clicked", () => {
    const items = [makeItem()];
    render(<DataSection content={items} />);
    fireEvent.click(screen.getByText("Export JSON"));
    expect(mockExportJSON).toHaveBeenCalledWith(items, { period: "all", type: "all" });
  });

  it("updates scope when period pill is clicked", () => {
    const items = [makeItem()];
    render(<DataSection content={items} />);
    fireEvent.click(screen.getByText("Today"));
    fireEvent.click(screen.getByText("Export CSV"));
    expect(mockExportCSV).toHaveBeenCalledWith(items, { period: "today", type: "all" });
  });

  it("updates scope when type pill is clicked", () => {
    const items = [makeItem()];
    render(<DataSection content={items} />);
    fireEvent.click(screen.getByText("Quality only"));
    fireEvent.click(screen.getByText("Export JSON"));
    expect(mockExportJSON).toHaveBeenCalledWith(items, { period: "all", type: "quality" });
  });

  it("combines period and type scope", () => {
    const items = [makeItem()];
    render(<DataSection content={items} />);
    fireEvent.click(screen.getByText("7d"));
    fireEvent.click(screen.getByText("Quality only"));
    fireEvent.click(screen.getByText("Export CSV"));
    expect(mockExportCSV).toHaveBeenCalledWith(items, { period: "7d", type: "quality" });
  });
});

describe("DataSection — Data Management", () => {
  it("shows Clear Content Cache and Reset Preferences buttons", () => {
    const html = renderToStaticMarkup(<DataSection content={[]} />);
    expect(html).toContain("Clear Content Cache");
    expect(html).toContain("Reset Preferences");
  });

  it("shows description text about cache and preferences", () => {
    const html = renderToStaticMarkup(<DataSection content={[]} />);
    expect(html).toContain("Cache stores dedup hashes");
    expect(html).toContain("source state");
  });

  it("Clear Cache requires confirmation click", () => {
    render(<DataSection content={[]} />);
    fireEvent.click(screen.getByText("Clear Content Cache"));
    // Should show confirmation state
    expect(screen.getByText("Clear cache?")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("Clear Cache clears localStorage on Confirm", () => {
    localStorage.setItem("aegis_article_dedup", "data");
    localStorage.setItem("aegis_source_states", "data");
    render(<DataSection content={[]} />);
    fireEvent.click(screen.getByText("Clear Content Cache"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(localStorage.getItem("aegis_article_dedup")).toBeNull();
    expect(localStorage.getItem("aegis_source_states")).toBeNull();
    expect(mockAddNotification).toHaveBeenCalledWith("Content cache cleared", "success");
  });

  it("Clear Cache Cancel restores normal state", () => {
    render(<DataSection content={[]} />);
    fireEvent.click(screen.getByText("Clear Content Cache"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Clear Content Cache")).toBeInTheDocument();
    expect(screen.queryByText("Clear cache?")).toBeNull();
  });

  it("Reset Preferences is disabled when not authenticated", () => {
    mockIsAuthenticated = false;
    const html = renderToStaticMarkup(<DataSection content={[]} />);
    expect(html).toContain("not-allowed");
  });

  it("Reset Preferences is enabled when authenticated", () => {
    const html = renderToStaticMarkup(<DataSection content={[]} />);
    const resetIdx = html.indexOf("Reset Preferences");
    const btnStart = html.lastIndexOf("<button", resetIdx);
    const btnEnd = html.indexOf("</button>", resetIdx);
    const btn = html.slice(btnStart, btnEnd);
    expect(btn).toContain("pointer");
    expect(btn).not.toContain("not-allowed");
  });

  it("Reset Preferences clears principal-specific localStorage", () => {
    localStorage.setItem("aegis_prefs_test-principal", "data");
    render(<DataSection content={[]} />);
    fireEvent.click(screen.getByText("Reset Preferences"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(localStorage.getItem("aegis_prefs_test-principal")).toBeNull();
    expect(mockAddNotification).toHaveBeenCalledWith("Preferences reset — reload to apply", "success");
  });
});

describe("DataSection — mobile", () => {
  it("renders without error in mobile mode", () => {
    const html = renderToStaticMarkup(<DataSection mobile content={[]} />);
    expect(html).toContain("Data Management");
    expect(html).toContain("Export");
  });
});
