"use client";
import React from "react";
import { fonts } from "@/styles/theme";
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

  // Compute real validated/flagged counts for false positive estimate
  const validated = content.filter(c => c.validated);
  const flagged = content.filter(c => c.flagged);
  const userReviewed = validated.length + flagged.length;
  // False positive: items scored "quality" but user flagged them
  const falsePositives = content.filter(c => c.verdict === "quality" && c.flagged).length;
  const falsePositiveRate = userReviewed > 0 ? ((falsePositives / userReviewed) * 100).toFixed(1) : "--";

  const sourceDistribution: Record<string, number> = {};
  for (const c of content) {
    sourceDistribution[c.source] = (sourceDistribution[c.source] || 0) + 1;
  }

  const scoreBuckets = Array(10).fill(0);
  for (const c of content) {
    const idx = Math.min(9, Math.floor(c.scores.composite));
    scoreBuckets[idx]++;
  }

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Analytics</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Performance & content metrics</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(3,1fr)", gap: mobile ? 10 : 14, marginBottom: mobile ? 18 : 22 }}>
        <StatCard icon={<ShieldIcon s={16} />} label="Accuracy" value={`${accuracy}%`} sub={`${qual.length} quality / ${content.length} total`} color="#34d399" mobile={mobile} />
        <StatCard icon={<FireIcon s={16} />} label="False Positive" value={falsePositiveRate === "--" ? "--" : `${falsePositiveRate}%`} sub={userReviewed > 0 ? `${userReviewed} user-reviewed` : "no reviews yet"} color="#fbbf24" mobile={mobile} />
        <StatCard icon={<ZapIcon s={16} />} label="User Reviews" value={userReviewed} sub={`${validated.length} validated, ${flagged.length} flagged`} color="#818cf8" mobile={mobile} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 12 : 16, marginBottom: mobile ? 18 : 22 }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: mobile ? 16 : 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 14 }}>Score Distribution</div>
          <BarChart
            data={scoreBuckets}
            labels={["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]}
            color="#38bdf8"
          />
        </div>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: mobile ? 16 : 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 14 }}>Content Sources</div>
          <BarChart
            data={Object.values(sourceDistribution)}
            labels={Object.keys(sourceDistribution)}
            color="#a78bfa"
          />
        </div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: mobile ? 16 : 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 14 }}>Evaluation Summary</div>
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? 8 : 12 }}>
          {[
            ["Total Evaluated", String(content.length), "#38bdf8"],
            ["Quality Found", String(qual.length), "#34d399"],
            ["Slop Caught", String(slop.length), "#f87171"],
            ["Accuracy", `${accuracy}%`, "#fbbf24"],
          ].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "center", padding: "12px 8px", background: "rgba(0,0,0,0.2)", borderRadius: 10 }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: mobile ? 18 : 20, fontWeight: 800, color: c, fontFamily: fonts.mono }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
