/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import { WhyFilteredModal, type BurnReasonKind } from "@/components/ui/WhyFilteredModal";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "owner",
    author: "Test Author",
    avatar: "T",
    text: "Why bitcoin will reach 1M",
    source: "rss",
    scores: { originality: 4, insight: 5, credibility: 6, composite: 5 },
    verdict: "slop",
    reason: "[claude-byok] Engagement bait pattern detected.",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    scoringEngine: "claude-byok",
    vSignal: 4,
    cContext: 3,
    lSlop: 8,
    ...overrides,
  };
}

describe("WhyFilteredModal", () => {
  it("renders verdict-slop banner with item text and engine label", () => {
    const item = makeItem();
    const reason: BurnReasonKind = { kind: "verdict-slop" };
    render(
      <WhyFilteredModal open onClose={() => {}} item={item} reason={reason} qualityThreshold={4} />,
    );
    expect(screen.getByText(/Filtered as slop/i)).toBeInTheDocument();
    expect(screen.getByText(/Why bitcoin will reach 1M/i)).toBeInTheDocument();
    expect(screen.getByText("Claude (BYOK)")).toBeInTheDocument();
    // Engine prefix stripped from reason text.
    expect(screen.getByText(/Engagement bait pattern detected/i)).toBeInTheDocument();
    // V/C/L breakdown rendered.
    expect(screen.getByText(/V — Signal/i)).toBeInTheDocument();
    expect(screen.getByText(/C — Context/i)).toBeInTheDocument();
    expect(screen.getByText(/L — Slop/i)).toBeInTheDocument();
    // O/I/C breakdown.
    expect(screen.getByText(/Originality/i)).toBeInTheDocument();
  });

  it("renders below-threshold banner with composite vs threshold", () => {
    const item = makeItem({ scores: { originality: 3, insight: 2, credibility: 2, composite: 2.3 } });
    const reason: BurnReasonKind = { kind: "below-threshold", composite: 2.3, threshold: 4 };
    render(
      <WhyFilteredModal open onClose={() => {}} item={item} reason={reason} qualityThreshold={4} />,
    );
    expect(screen.getByText(/Below quality threshold/i)).toBeInTheDocument();
    expect(screen.getAllByText("2.3").length).toBeGreaterThanOrEqual(1);
  });

  it("renders custom-rule banner with field and pattern", () => {
    const item = makeItem();
    const reason: BurnReasonKind = {
      kind: "custom-rule",
      rule: { itemId: "item-1", ruleId: "r-1", field: "title", pattern: "bitcoin" },
    };
    render(
      <WhyFilteredModal open onClose={() => {}} item={item} reason={reason} qualityThreshold={4} />,
    );
    expect(screen.getByText(/Burned by custom rule/i)).toBeInTheDocument();
    expect(screen.getByText(/title/)).toBeInTheDocument();
    expect(screen.getByText(/"bitcoin"/)).toBeInTheDocument();
  });

  it("falls back to 'Unknown engine' when scoringEngine missing and no engine prefix in reason", () => {
    const item = makeItem({ scoringEngine: undefined, reason: "Plain reason without engine prefix." });
    const reason: BurnReasonKind = { kind: "verdict-slop" };
    render(
      <WhyFilteredModal open onClose={() => {}} item={item} reason={reason} qualityThreshold={4} />,
    );
    expect(screen.getByText("Unknown engine")).toBeInTheDocument();
  });

  it("hides V/C/L section when those scores are missing (heuristic items)", () => {
    const item = makeItem({ vSignal: undefined, cContext: undefined, lSlop: undefined });
    const reason: BurnReasonKind = { kind: "verdict-slop" };
    render(
      <WhyFilteredModal open onClose={() => {}} item={item} reason={reason} qualityThreshold={4} />,
    );
    expect(screen.queryByText(/V — Signal/i)).not.toBeInTheDocument();
    // O/I/C still rendered.
    expect(screen.getByText(/Originality/i)).toBeInTheDocument();
  });
});
