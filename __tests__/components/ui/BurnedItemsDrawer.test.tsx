/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BurnedItemsDrawer } from "@/components/ui/BurnedItemsDrawer";
import type { ContentItem } from "@/lib/types/content";
import type { BurnedByRule } from "@/lib/filtering/types";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    owner: "owner",
    author: "Author",
    avatar: "A",
    text: "Sample text",
    source: "rss",
    scores: { originality: 3, insight: 3, credibility: 3, composite: 3 },
    verdict: "quality",
    reason: "[heuristic] no signal",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    scoringEngine: "heuristic",
    ...overrides,
  };
}

describe("BurnedItemsDrawer", () => {
  it("renders empty state when no items match any burn category", () => {
    render(
      <BurnedItemsDrawer
        open
        onClose={() => {}}
        items={[makeItem({ id: "a", verdict: "quality" })]}
        burnedByRule={[]}
        burnedByThreshold={[]}
        qualityThreshold={4}
      />,
    );
    expect(screen.getByText(/Nothing has been filtered out yet/i)).toBeInTheDocument();
  });

  it("classifies and lists slop, below-threshold, and custom-rule burns separately", () => {
    const items = [
      makeItem({ id: "a", text: "Slop item", verdict: "slop" }),
      makeItem({ id: "b", text: "Threshold item", verdict: "quality", scores: { originality: 1, insight: 1, credibility: 1, composite: 2 } }),
      makeItem({ id: "c", text: "Rule item", verdict: "quality" }),
    ];
    const burnedByRule: BurnedByRule[] = [
      { itemId: "c", ruleId: "r-1", field: "author", pattern: "Author" },
    ];
    const burnedByThreshold = ["b"];
    render(
      <BurnedItemsDrawer
        open
        onClose={() => {}}
        items={items}
        burnedByRule={burnedByRule}
        burnedByThreshold={burnedByThreshold}
        qualityThreshold={4}
      />,
    );
    expect(screen.getByText("Slop item")).toBeInTheDocument();
    expect(screen.getByText("Threshold item")).toBeInTheDocument();
    expect(screen.getByText("Rule item")).toBeInTheDocument();
    expect(screen.getByText(/Filtered out — 3 items/i)).toBeInTheDocument();
  });

  it("shows summary counters", () => {
    const items = [makeItem({ id: "a", verdict: "slop" })];
    render(
      <BurnedItemsDrawer
        open
        onClose={() => {}}
        items={items}
        burnedByRule={[]}
        burnedByThreshold={[]}
        qualityThreshold={4}
      />,
    );
    // Counts visible (slop=1, threshold=0, rule=0).
    expect(screen.getByText(/Slop:/i).textContent).toContain("1");
  });

  it("opens WhyFilteredModal when 'Why?' is clicked", () => {
    const items = [makeItem({ id: "a", text: "Modal-target", verdict: "slop" })];
    render(
      <BurnedItemsDrawer
        open
        onClose={() => {}}
        items={items}
        burnedByRule={[]}
        burnedByThreshold={[]}
        qualityThreshold={4}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Why\?/i }));
    expect(screen.getByTestId("why-filtered-modal")).toBeInTheDocument();
  });

  it("respects maxItems cap and shows truncation note", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `item-${i}`, text: `Slop ${i}`, verdict: "slop" }),
    );
    render(
      <BurnedItemsDrawer
        open
        onClose={() => {}}
        items={items}
        burnedByRule={[]}
        burnedByThreshold={[]}
        qualityThreshold={4}
        maxItems={2}
      />,
    );
    expect(screen.getByText("Slop 0")).toBeInTheDocument();
    expect(screen.getByText("Slop 1")).toBeInTheDocument();
    expect(screen.queryByText("Slop 2")).not.toBeInTheDocument();
    expect(screen.getByText(/Showing the first 2/)).toBeInTheDocument();
  });
});
