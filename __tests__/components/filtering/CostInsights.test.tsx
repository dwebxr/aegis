import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CostInsights } from "@/components/filtering/CostInsights";
import type { FilterPipelineStats } from "@/lib/filtering/types";

function makeStats(overrides: Partial<FilterPipelineStats> = {}): FilterPipelineStats {
  return {
    totalInput: 100,
    wotScoredCount: 50,
    aiScoredCount: 30,
    serendipityCount: 2,
    estimatedAPICost: 0.09,
    mode: "pro",
    ...overrides,
  };
}

describe("CostInsights", () => {
  describe("compact mode (expanded=false)", () => {
    it("renders KPI values from stats", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats()} />);
      expect(html).toContain("PRO");
      expect(html).toContain("50"); // WoT Scored
      expect(html).toContain("30"); // AI Calls
      expect(html).toContain("$0.090"); // API Cost
    });

    it("renders Lite mode label", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats({ mode: "lite" })} />);
      expect(html).toContain("LITE");
    });

    it("shows savings message in Lite mode", () => {
      const stats = makeStats({ mode: "lite", totalInput: 100 });
      const html = renderToStaticMarkup(<CostInsights stats={stats} />);
      expect(html).toContain("savings");
      expect(html).toContain("Lite mode");
    });

    it("does not show savings in Pro mode", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats({ mode: "pro" })} />);
      expect(html).not.toContain("savings");
    });

    it("shows serendipity count when > 0", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats({ serendipityCount: 3 })} />);
      expect(html).toContain("3 serendipity items");
    });

    it("pluralizes serendipity correctly (1 item)", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats({ serendipityCount: 1 })} />);
      expect(html).toContain("1 serendipity item ");
      expect(html).not.toContain("items");
    });

    it("hides serendipity section when count is 0", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats({ serendipityCount: 0 })} />);
      expect(html).not.toContain("serendipity item");
    });

    it("does not render expanded sections when expanded is false", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats()} expanded={false} />);
      expect(html).not.toContain("Your Usage");
      expect(html).not.toContain("Lite vs Pro");
      expect(html).not.toContain("vs Other Services (Estimates)");
    });
  });

  describe("expanded mode", () => {
    it("renders MonthlyUsage section", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats()} expanded />);
      expect(html).toContain("Your Usage");
    });

    it("renders LiteVsProTable section", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats()} expanded />);
      expect(html).toContain("Lite vs Pro");
      expect(html).toContain("Heuristic");
      expect(html).toContain("AI (Claude)");
    });

    it("renders CompetitorComparison section", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats()} expanded />);
      expect(html).toContain("vs Other Services");
      expect(html).toContain("X Premium");
      expect(html).toContain("Manual Curation");
    });

    it("renders LiteVsProTable with all feature rows", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats()} expanded />);
      expect(html).toContain("Scoring");
      expect(html).toContain("WoT Filter");
      expect(html).toContain("Cost/Article");
      expect(html).toContain("Serendipity");
      expect(html).toContain("Discoveries");
      expect(html).toContain("Accuracy");
    });
  });

  describe("edge cases", () => {
    it("handles zero API cost", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats({ estimatedAPICost: 0 })} />);
      expect(html).toContain("$0.000");
    });

    it("handles very large API cost", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats({ estimatedAPICost: 99.999 })} />);
      expect(html).toContain("$99.999");
    });

    it("handles zero totalInput in lite mode (no savings)", () => {
      const stats = makeStats({ mode: "lite", totalInput: 0 });
      const html = renderToStaticMarkup(<CostInsights stats={stats} />);
      expect(html).not.toContain("savings");
    });

    it("renders correctly with mobile=true", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats()} mobile />);
      // Should render without errors
      expect(html).toContain("Filter Pipeline");
    });

    it("renders correctly with mobile=false", () => {
      const html = renderToStaticMarkup(<CostInsights stats={makeStats()} mobile={false} />);
      expect(html).toContain("Filter Pipeline");
    });
  });
});
