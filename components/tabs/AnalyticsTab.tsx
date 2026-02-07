"use client";
import React from "react";
import { fonts, colors, space, type as t, radii, kpiLabelStyle } from "@/styles/theme";
import { ShieldIcon, FireIcon, ZapIcon } from "@/components/icons";
import { StatCard } from "@/components/ui/StatCard";
import { BarChart } from "@/components/ui/BarChart";
import type { ContentItem } from "@/lib/types/content";

interface AnalyticsTabProps {
  content: ContentItem[];
  mobile?: boolean;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ content, mobile }) => {
  const qual = content.filter(c => c.verdict === "quality");
  const slop = content.filter(c => c.verdict === "slop");
  const accuracy = content.length > 0 ? ((qual.length / content.length) * 100).toFixed(1) : "0.0";

  const validated = content.filter(c => c.validated);
  const flagged = content.filter(c => c.flagged);
  const userReviewed = validated.length + flagged.length;
  const falsePositives = content.filter(c => c.verdict === "quality" && c.flagged).length;
  const totalPredictedQuality = qual.length;
  const falsePositiveRate = totalPredictedQuality > 0 ? ((falsePositives / totalPredictedQuality) * 100).toFixed(1) : "--";

  const sourceDistribution: Record<string, number> = {};
  for (const c of content) {
    sourceDistribution[c.source] = (sourceDistribution[c.source] || 0) + 1;
  }

  const scoreBuckets = Array(10).fill(0);
  for (const c of content) {
    const idx = Math.max(0, Math.min(9, Math.floor(c.scores.composite)));
    scoreBuckets[idx]++;
  }

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: mobile ? space[8] : space[12] }}>
        <h1 style={{
          fontSize: mobile ? t.display.mobileSz : t.display.size,
          fontWeight: t.display.weight,
          lineHeight: t.display.lineHeight,
          letterSpacing: t.display.letterSpacing,
          color: colors.text.primary,
          margin: 0,
        }}>
          Analytics
        </h1>
        <p style={{ fontSize: mobile ? t.body.mobileSz : t.body.size, color: colors.text.muted, marginTop: space[2] }}>
          Performance & content metrics
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(3,1fr)", gap: mobile ? space[3] : space[4], marginBottom: mobile ? space[12] : space[16] }}>
        <StatCard icon={<ShieldIcon s={16} />} label="Accuracy" value={`${accuracy}%`} sub={`${qual.length} quality / ${content.length} total`} color={colors.green[400]} mobile={mobile} />
        <StatCard icon={<FireIcon s={16} />} label="False Positive" value={falsePositiveRate === "--" ? "--" : `${falsePositiveRate}%`} sub={userReviewed > 0 ? `${userReviewed} user-reviewed` : "no reviews yet"} color={colors.orange[400]} mobile={mobile} />
        <StatCard icon={<ZapIcon s={16} />} label="User Reviews" value={userReviewed} sub={`${validated.length} validated, ${flagged.length} flagged`} color={colors.purple[400]} mobile={mobile} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? space[3] : space[4], marginBottom: mobile ? space[12] : space[16] }}>
        <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5] }}>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[4] }}>Score Distribution</div>
          <BarChart data={scoreBuckets} labels={["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]} color={colors.sky[400]} />
        </div>
        <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5] }}>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[4] }}>Content Sources</div>
          <BarChart data={Object.values(sourceDistribution)} labels={Object.keys(sourceDistribution)} color={colors.purple[400]} />
        </div>
      </div>

      <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5] }}>
        <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[4] }}>Evaluation Summary</div>
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? space[2] : space[3] }}>
          {[
            ["Total Evaluated", String(content.length), colors.sky[400]],
            ["Quality Found", String(qual.length), colors.green[400]],
            ["Slop Caught", String(slop.length), colors.orange[400]],
            ["Accuracy", `${accuracy}%`, colors.amber[400]],
          ].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "center", padding: `${space[3]}px ${space[2]}px`, background: colors.bg.raised, borderRadius: radii.sm }}>
              <div style={{ ...kpiLabelStyle, marginBottom: space[1] }}>{l}</div>
              <div style={{ fontSize: mobile ? t.h1.mobileSz : t.h1.size, fontWeight: t.kpiValue.weight, color: c, fontFamily: fonts.mono }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
