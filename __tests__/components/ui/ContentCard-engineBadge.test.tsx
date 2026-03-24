/**
 * @jest-environment jsdom
 */
/**
 * ContentCard — scoringEngine badge tests.
 * Verifies the AI/H indicator renders correctly based on scoringEngine field.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { ContentCard } from "@/components/ui/ContentCard";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-id",
    owner: "test-owner",
    author: "test-author",
    avatar: "",
    text: "Test content for engine badge",
    source: "rss",
    scores: { originality: 7, insight: 6, credibility: 8, composite: 7 },
    verdict: "quality",
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

const noop = () => {};

function renderCard(overrides: Partial<ContentItem> = {}) {
  return render(
    <ContentCard
      item={makeItem(overrides)}
      expanded={false}
      onToggle={noop}
      onValidate={noop}
      onFlag={noop}
    />,
  );
}

describe("ContentCard — scoringEngine badge", () => {
  it("shows 'H' for heuristic engine", () => {
    renderCard({ scoringEngine: "heuristic" });
    const badge = screen.getByText("H");
    expect(badge).toBeTruthy();
    expect(badge.className).toContain("amber");
  });

  it("shows 'AI' for claude-server engine", () => {
    renderCard({ scoringEngine: "claude-server" });
    const badge = screen.getByText("AI");
    expect(badge).toBeTruthy();
    expect(badge.className).toContain("sky");
  });

  it("shows 'AI' for ollama engine", () => {
    renderCard({ scoringEngine: "ollama" });
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("shows 'AI' for webllm engine", () => {
    renderCard({ scoringEngine: "webllm" });
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("shows 'AI' for claude-ic engine", () => {
    renderCard({ scoringEngine: "claude-ic" });
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("shows 'AI' for claude-byok engine", () => {
    renderCard({ scoringEngine: "claude-byok" });
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("shows no badge when scoringEngine is undefined", () => {
    renderCard({ scoringEngine: undefined });
    expect(screen.queryByText("AI")).toBeNull();
    expect(screen.queryByText("H")).toBeNull();
  });
});
