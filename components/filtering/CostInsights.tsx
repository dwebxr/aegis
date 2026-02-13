"use client";
import React, { useMemo } from "react";
import { colors, space, type as t, radii, fonts, kpiLabelStyle } from "@/styles/theme";
import type { FilterPipelineStats } from "@/lib/filtering/types";
import { getMonthlyCost } from "@/lib/filtering/costTracker";

interface CostInsightsProps {
  stats: FilterPipelineStats;
  mobile?: boolean;
  expanded?: boolean;
}

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
    <div style={{
      background: colors.bg.surface,
      border: `1px solid ${colors.border.default}`,
      borderRadius: radii.lg,
      padding: mobile ? space[4] : space[5],
    }}>
      <div style={{
        fontSize: t.h3.size,
        fontWeight: t.h3.weight,
        color: colors.cyan[400],
        marginBottom: space[4],
      }}>
        Filter Pipeline
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)",
        gap: mobile ? space[2] : space[3],
      }}>
        {kpis.map(([label, value, color]) => (
          <div key={label} style={{
            textAlign: "center",
            padding: `${space[3]}px ${space[2]}px`,
            background: colors.bg.raised,
            borderRadius: radii.sm,
          }}>
            <div style={{ ...kpiLabelStyle, marginBottom: space[1] }}>{label}</div>
            <div style={{
              fontSize: mobile ? t.bodySm.size : t.body.size,
              fontWeight: t.kpiValue.weight,
              color,
              fontFamily: fonts.mono,
            }}>{value}</div>
          </div>
        ))}
      </div>

      {stats.mode === "lite" && costSaved > 0 && (
        <div style={{
          marginTop: space[3],
          textAlign: "center",
          padding: `${space[2]}px`,
          background: colors.green.bg,
          borderRadius: radii.sm,
          fontSize: t.bodySm.size,
          color: colors.green[400],
          fontWeight: 600,
        }}>
          Estimated API savings: ~${costSaved.toFixed(3)} by using Lite mode (heuristic scoring)
        </div>
      )}

      {stats.serendipityCount > 0 && (
        <div style={{
          marginTop: space[2],
          textAlign: "center",
          padding: `${space[2]}px`,
          background: "rgba(167,139,250,0.06)",
          borderRadius: radii.sm,
          fontSize: t.bodySm.size,
          color: colors.purple[400],
        }}>
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
      <div style={{
        marginTop: space[4],
        padding: space[3],
        background: colors.bg.raised,
        borderRadius: radii.md,
        textAlign: "center",
        fontSize: t.bodySm.size,
        color: colors.text.muted,
      }}>
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
    <div style={{ marginTop: space[4] }}>
      <div style={{
        fontSize: t.h3.size,
        fontWeight: t.h3.weight,
        color: colors.amber[400],
        marginBottom: space[3],
      }}>
        Your Usage (This Month)
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(3,1fr)",
        gap: space[2],
      }}>
        {monthlyKpis.map(([label, value, color]) => (
          <div key={label} style={{
            textAlign: "center",
            padding: `${space[3]}px ${space[2]}px`,
            background: colors.bg.raised,
            borderRadius: radii.sm,
          }}>
            <div style={{ ...kpiLabelStyle, marginBottom: space[1] }}>{label}</div>
            <div style={{
              fontSize: mobile ? t.bodySm.size : t.body.size,
              fontWeight: t.kpiValue.weight,
              color,
              fontFamily: fonts.mono,
            }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiteVsProTable() {
  const rows: Array<{ feature: string; lite: string; pro: string }> = [
    { feature: "Scoring", lite: "Heuristic", pro: "AI (Claude)" },
    { feature: "WoT Filter", lite: "\u2705", pro: "\u2705" },
    { feature: "Cost/Article", lite: "~$0", pro: "~$0.003" },
    { feature: "Serendipity", lite: "Topic", pro: "Topic + WoT" },
    { feature: "Discoveries", lite: "\u2014", pro: "Up to 5" },
    { feature: "Accuracy", lite: "Good", pro: "Best" },
  ];

  return (
    <div style={{ marginTop: space[4] }}>
      <div style={{
        fontSize: t.h3.size,
        fontWeight: t.h3.weight,
        color: colors.cyan[400],
        marginBottom: space[3],
      }}>
        Lite vs Pro
      </div>
      <div style={{
        background: colors.bg.raised,
        borderRadius: radii.md,
        overflow: "hidden",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr",
          padding: `${space[2]}px ${space[3]}px`,
          borderBottom: `1px solid ${colors.border.default}`,
        }}>
          <div style={{ ...kpiLabelStyle }}>Feature</div>
          <div style={{ ...kpiLabelStyle, textAlign: "center", color: colors.green[400] }}>Lite</div>
          <div style={{ ...kpiLabelStyle, textAlign: "center", color: colors.purple[400] }}>Pro</div>
        </div>
        {rows.map((row, i) => (
          <div key={row.feature} style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr",
            padding: `${space[2]}px ${space[3]}px`,
            borderBottom: i < rows.length - 1 ? `1px solid ${colors.border.subtle}` : "none",
          }}>
            <div style={{ fontSize: t.bodySm.size, color: colors.text.tertiary }}>{row.feature}</div>
            <div style={{ fontSize: t.bodySm.size, color: colors.text.secondary, textAlign: "center" }}>{row.lite}</div>
            <div style={{ fontSize: t.bodySm.size, color: colors.text.secondary, textAlign: "center" }}>{row.pro}</div>
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
    color: string;
    highlight?: boolean;
  }> = [
    {
      name: "Aegis (Your Usage)",
      costUSD: `$${monthly.totalAiCostUSD.toFixed(2)}/mo`,
      sub: "Automated AI + WoT filtering",
      color: colors.green[400],
      highlight: true,
    },
    {
      name: "X Premium (est.)",
      costUSD: "~$8/mo",
      sub: "Algorithmic feed, no quality filter",
      color: colors.sky[400],
    },
    {
      name: "News Sub (est.)",
      costUSD: "~$10/mo",
      sub: "Single source, curated editorially",
      color: colors.orange[400],
    },
    {
      name: "Manual Curation",
      costUSD: "$0",
      sub: "~2h/day estimated time cost",
      color: colors.red[400],
    },
  ];

  return (
    <div style={{ marginTop: space[4] }}>
      <div style={{
        fontSize: t.h3.size,
        fontWeight: t.h3.weight,
        color: colors.green[400],
        marginBottom: space[3],
      }}>
        vs Other Services (Estimates)
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
        gap: space[2],
      }}>
        {competitors.map(c => (
          <div key={c.name} style={{
            padding: `${space[3]}px ${space[4]}px`,
            background: c.highlight ? "rgba(52,211,153,0.06)" : colors.bg.raised,
            border: c.highlight ? `1px solid ${colors.green.border}` : `1px solid ${colors.border.subtle}`,
            borderRadius: radii.md,
          }}>
            <div style={{
              fontSize: t.bodySm.size,
              fontWeight: 700,
              color: c.color,
              marginBottom: space[1],
            }}>
              {c.name}
            </div>
            <div style={{
              fontSize: t.h2.size,
              fontWeight: t.kpiValue.weight,
              color: colors.text.primary,
              fontFamily: fonts.mono,
            }}>
              {c.costUSD}
            </div>
            <div style={{
              fontSize: t.caption.size,
              color: colors.text.muted,
              marginTop: space[1],
            }}>
              {c.sub}
            </div>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: space[2],
        fontSize: t.caption.size,
        color: colors.text.muted,
        textAlign: "center",
        fontStyle: "italic",
      }}>
        Competitor prices are approximate public rates. Aegis cost is your actual API usage.
      </div>
    </div>
  );
}
