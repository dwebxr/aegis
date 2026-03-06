"use client";
import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { colors } from "@/styles/theme";
import type { FilterPipelineStats } from "@/lib/filtering/types";
import { getMonthlyCost } from "@/lib/filtering/costTracker";

interface CostInsightsProps {
  stats: FilterPipelineStats;
  mobile?: boolean;
  expanded?: boolean;
}

const kpiLabel = "text-tiny font-bold uppercase tracking-[0.5px] text-[var(--color-text-disabled)]";

export const CostInsights: React.FC<CostInsightsProps> = ({ stats, mobile, expanded = false }) => {
  const costSaved = stats.mode === "lite" && stats.totalInput > 0
    ? stats.totalInput * 0.003
    : 0;

  const kpis: Array<[string, string, string]> = [
    ["Mode", stats.mode.toUpperCase(), stats.mode === "lite" ? colors.green[400] : colors.purple[400]],
    ["WoT Scored", String(stats.wotScoredCount), colors.cyan[400]],
    ["AI Calls", String(stats.aiScoredCount), colors.orange[400]],
    ["API Cost", `$${stats.estimatedAPICost.toFixed(3)}`, colors.amber[400]],
  ];

  return (
    <div className={cn("bg-card border border-border rounded-lg", mobile ? "p-4" : "p-5")}>
      <div className="text-h3 font-semibold text-cyan-400 mb-4">
        Filter Pipeline
      </div>

      <div className={cn("grid gap-2", mobile ? "grid-cols-2 gap-2" : "grid-cols-4 gap-3")}>
        {kpis.map(([label, value, color]) => (
          <div key={label} className="text-center px-2 py-3 bg-navy-lighter rounded-sm">
            <div className={cn(kpiLabel, "mb-1")}>{label}</div>
            <div className={cn("font-bold font-mono", mobile ? "text-body-sm" : "text-body")} style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {stats.mode === "lite" && costSaved > 0 && (
        <div className="mt-3 text-center p-2 bg-green-400/[0.06] rounded-sm text-body-sm text-green-400 font-semibold">
          Estimated API savings: ~${costSaved.toFixed(3)} by using Lite mode (heuristic scoring)
        </div>
      )}

      {stats.serendipityCount > 0 && (
        <div className="mt-2 text-center p-2 bg-purple-400/[0.06] rounded-sm text-body-sm text-purple-400">
          {stats.serendipityCount} serendipity item{stats.serendipityCount > 1 ? "s" : ""} discovered via WoT
        </div>
      )}

      {expanded && (
        <>
          <MonthlyUsage mobile={mobile} />
          <LiteVsProTable />
          <CompetitorComparison mobile={mobile} />
        </>
      )}
    </div>
  );
};

function MonthlyUsage({ mobile }: { mobile?: boolean }) {
  const monthly = useMemo(() => getMonthlyCost(), []);

  if (monthly.totalDays === 0) {
    return (
      <div className="mt-4 p-3 bg-navy-lighter rounded-md text-center text-body-sm text-muted-foreground">
        No usage data this month yet. Keep filtering!
      </div>
    );
  }

  const costPerQuality = monthly.totalPassedAI > 0
    ? (monthly.totalAiCostUSD / monthly.totalPassedAI).toFixed(4)
    : "--";

  const monthlyKpis: Array<[string, string, string]> = [
    ["Evaluated", String(monthly.totalEvaluated), colors.cyan[400]],
    ["AI Scored", String(monthly.totalPassedAI), colors.orange[400]],
    ["Discoveries", String(monthly.totalDiscoveries), colors.purple[400]],
    ["Cost", `$${monthly.totalAiCostUSD.toFixed(2)}`, colors.amber[400]],
    ["Time Saved", monthly.timeSavedFormatted, colors.green[400]],
    ["Per Quality", `$${costPerQuality}`, colors.sky[400]],
  ];

  return (
    <div className="mt-4">
      <div className="text-h3 font-semibold text-amber-400 mb-3">
        Your Usage (This Month)
      </div>
      <div className={cn("grid gap-2", mobile ? "grid-cols-2" : "grid-cols-3")}>
        {monthlyKpis.map(([label, value, color]) => (
          <div key={label} className="text-center px-2 py-3 bg-navy-lighter rounded-sm">
            <div className={cn(kpiLabel, "mb-1")}>{label}</div>
            <div className={cn("font-bold font-mono", mobile ? "text-body-sm" : "text-body")} style={{ color }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiteVsProTable() {
  const rows: Array<{ feature: string; lite: string; pro: string }> = [
    { feature: "Scoring", lite: "Heuristic", pro: "AI (IC LLM default)" },
    { feature: "WoT Filter", lite: "\u2705", pro: "\u2705" },
    { feature: "Cost/Article", lite: "~$0", pro: "~$0.003 est." },
    { feature: "Serendipity", lite: "Topic", pro: "Topic + WoT" },
    { feature: "Discoveries", lite: "\u2014", pro: "Up to 5" },
    { feature: "Accuracy", lite: "Good", pro: "Best" },
  ];

  return (
    <div className="mt-4">
      <div className="text-h3 font-semibold text-cyan-400 mb-3">
        Lite vs Pro
      </div>
      <div className="bg-navy-lighter rounded-md overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr] px-3 py-2 border-b border-border">
          <div className={kpiLabel}>Feature</div>
          <div className={cn(kpiLabel, "text-center !text-green-400")}>Lite</div>
          <div className={cn(kpiLabel, "text-center !text-purple-400")}>Pro</div>
        </div>
        {rows.map((row, i) => (
          <div key={row.feature} className={cn(
            "grid grid-cols-[2fr_1fr_1fr] px-3 py-2",
            i < rows.length - 1 && "border-b border-[var(--color-border-subtle)]"
          )}>
            <div className="text-body-sm text-[var(--color-text-tertiary)]">{row.feature}</div>
            <div className="text-body-sm text-secondary-foreground text-center">{row.lite}</div>
            <div className="text-body-sm text-secondary-foreground text-center">{row.pro}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitorComparison({ mobile }: { mobile?: boolean }) {
  const monthly = useMemo(() => getMonthlyCost(), []);
  const competitors: Array<{
    name: string;
    costUSD: string;
    sub: string;
    colorClass: string;
    highlight?: boolean;
  }> = [
    {
      name: "Aegis (Your Usage)",
      costUSD: `$${monthly.totalAiCostUSD.toFixed(2)}/mo`,
      sub: "Estimated AI API cost + WoT filtering",
      colorClass: "text-green-400",
      highlight: true,
    },
    {
      name: "X Premium (est.)",
      costUSD: "~$8/mo",
      sub: "Algorithmic feed, no quality filter",
      colorClass: "text-sky-400",
    },
    {
      name: "News Sub (est.)",
      costUSD: "~$10/mo",
      sub: "Single source, curated editorially",
      colorClass: "text-orange-400",
    },
    {
      name: "Manual Curation",
      costUSD: "$0",
      sub: "~2h/day estimated time cost",
      colorClass: "text-red-400",
    },
  ];

  return (
    <div className="mt-4">
      <div className="text-h3 font-semibold text-green-400 mb-3">
        vs Other Services (Estimates)
      </div>
      <div className={cn("grid gap-2", mobile ? "grid-cols-1" : "grid-cols-2")}>
        {competitors.map(c => (
          <div key={c.name} className={cn(
            "px-4 py-3 rounded-md border",
            c.highlight
              ? "bg-emerald-400/[0.06] border-green-400/15"
              : "bg-navy-lighter border-[var(--color-border-subtle)]"
          )}>
            <div className={cn("text-body-sm font-bold mb-1", c.colorClass)}>
              {c.name}
            </div>
            <div className="text-h2 font-bold text-foreground font-mono">
              {c.costUSD}
            </div>
            <div className="text-caption text-muted-foreground mt-1">
              {c.sub}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-caption text-muted-foreground text-center italic">
        Competitor prices are approximate public rates. Aegis cost is your actual API usage.
      </div>
    </div>
  );
}
