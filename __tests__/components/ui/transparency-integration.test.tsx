/**
 * @jest-environment jsdom
 *
 * Integration: feeds REAL runFilterPipeline output into BurnedItemsDrawer,
 * opens the modal via user interaction, and verifies the displayed text
 * matches what the pipeline actually decided.
 *
 * Touches: lib/filtering/pipeline.ts (real), lib/filtering/customRules.ts
 * (real), components/ui/BurnedItemsDrawer.tsx (real), components/ui/
 * WhyFilteredModal.tsx (real). No mocks of code under test.
 */

import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { runFilterPipeline } from "@/lib/filtering/pipeline";
import { BurnedItemsDrawer } from "@/components/ui/BurnedItemsDrawer";
import type { ContentItem } from "@/lib/types/content";
import type { CustomFilterRule } from "@/lib/preferences/types";
import { ENGINE_LABELS, type ScoringEngine } from "@/lib/scoring/types";

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-default",
    owner: "owner",
    author: "Alice",
    avatar: "A",
    text: "default body",
    source: "rss",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "ok",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    scoringEngine: "claude-byok",
    ...overrides,
  };
}

describe("Pipeline → BurnedItemsDrawer → WhyFilteredModal — full integration", () => {
  it("classifies and surfaces all three burn categories from real pipeline output", () => {
    const allItems: ContentItem[] = [
      item({ id: "passes", text: "passes through", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
      item({ id: "below", text: "below threshold", scores: { originality: 1, insight: 1, credibility: 1, composite: 2 } }),
      item({ id: "ruled", text: "burned by rule", author: "SpamBot" }),
      item({ id: "slop", text: "engine slop", verdict: "slop", scores: { originality: 9, insight: 9, credibility: 9, composite: 9 } }),
    ];
    const rules: CustomFilterRule[] = [
      { id: "r1", field: "author", pattern: "SpamBot", createdAt: Date.now() },
    ];

    const result = runFilterPipeline(allItems, null, {
      mode: "lite", wotEnabled: false, qualityThreshold: 4.0, customRules: rules,
    });

    // Pipeline stats reflect reality. Note: pipeline filters by composite
    // threshold and custom rules only — `verdict === "slop"` with high
    // composite still passes the pipeline (verdict is metadata, not a filter
    // input). The Drawer's classify() then surfaces the slop label.
    expect(result.stats.burnedByThreshold).toContain("below");
    expect(result.stats.burnedByRule.map(b => b.itemId)).toEqual(["ruled"]);
    expect(result.items.map(fi => fi.item.id).sort()).toEqual(["passes", "slop"]);

    // Drawer sees the same items + stats and renders all three categories.
    render(
      <BurnedItemsDrawer
        open
        onClose={() => {}}
        items={allItems}
        burnedByRule={result.stats.burnedByRule}
        burnedByThreshold={result.stats.burnedByThreshold}
        qualityThreshold={4.0}
      />,
    );

    expect(screen.getByText(/Filtered out — 3 items/)).toBeInTheDocument();
    expect(screen.getByText("below threshold")).toBeInTheDocument();
    expect(screen.getByText("burned by rule")).toBeInTheDocument();
    expect(screen.getByText("engine slop")).toBeInTheDocument();
    expect(screen.queryByText("passes through")).not.toBeInTheDocument();

    // Open the modal for the rule-burned item.
    const buttons = screen.getAllByRole("button", { name: /Why\?/i });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[1]); // "burned by rule" — second in input order

    expect(screen.getByTestId("why-filtered-modal")).toBeInTheDocument();
    expect(screen.getByText(/Burned by custom rule/i)).toBeInTheDocument();
    // Multiple matches expected: author cell in the drawer row PLUS modal banner.
    expect(screen.getAllByText(/SpamBot/).length).toBeGreaterThanOrEqual(2);
  });

  it("modal threshold-comparison reflects the actual qualityThreshold prop", () => {
    const allItems = [
      item({ id: "low", text: "low scoring", scores: { originality: 1, insight: 1, credibility: 1, composite: 2.4 } }),
    ];
    const result = runFilterPipeline(allItems, null, {
      mode: "lite", wotEnabled: false, qualityThreshold: 4.0,
    });
    render(
      <BurnedItemsDrawer
        open
        onClose={() => {}}
        items={allItems}
        burnedByRule={result.stats.burnedByRule}
        burnedByThreshold={result.stats.burnedByThreshold}
        qualityThreshold={4.0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Why\?/i }));
    expect(screen.getByText(/Below quality threshold/)).toBeInTheDocument();
    expect(screen.getAllByText("2.4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4.0").length).toBeGreaterThan(0);
  });

  it("totals are inputs-based, not capped (regression for the maxItems counter bug)", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ id: `slop-${i}`, text: `slop ${i}`, verdict: "slop" }),
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
    // Title shows total (5), not capped count (2).
    expect(screen.getByText(/Filtered out — 5 items/)).toBeInTheDocument();
    // Slop summary counter shows 5, not 2.
    expect(screen.getByText(/Slop:/).textContent).toContain("5");
    // Truncation note is "Showing the first 2 of 5".
    expect(screen.getByText(/Showing the first 2 of 5/)).toBeInTheDocument();
  });
});

describe("WhyFilteredModal — engine label coverage", () => {
  // Verifies every documented engine in lib/scoring/types.ts ENGINE_LABELS
  // renders correctly when set on the item.
  const engines = Object.keys(ENGINE_LABELS) as ScoringEngine[];

  it.each(engines)("renders the human label for engine %s", (engine) => {
    const it = item({ scoringEngine: engine });
    render(
      <BurnedItemsDrawer
        open
        onClose={() => {}}
        items={[{ ...it, verdict: "slop" }]}
        burnedByRule={[]}
        burnedByThreshold={[]}
        qualityThreshold={4}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Why\?/i }));
    expect(screen.getByText(ENGINE_LABELS[engine])).toBeInTheDocument();
  });
});
