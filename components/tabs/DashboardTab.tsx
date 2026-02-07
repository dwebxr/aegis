"use client";
import React from "react";
import { ShieldIcon, FireIcon, ZapIcon, RSSIcon } from "@/components/icons";
import { StatCard } from "@/components/ui/StatCard";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard } from "@/components/ui/ContentCard";
import type { ContentItem } from "@/lib/types/content";

interface DashboardTabProps {
  content: ContentItem[];
  mobile?: boolean;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ content, mobile }) => {
  const qual = content.filter(c => c.verdict === "quality");
  const slop = content.filter(c => c.verdict === "slop");
  const uniqueSources = new Set(content.map(c => c.source));

  // Compute daily stats for last 7 days from real data
  const now = Date.now();
  const dayMs = 86400000;
  const dailyQuality: number[] = [];
  const dailySlop: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = now - (i + 1) * dayMs;
    const dayEnd = now - i * dayMs;
    const dayItems = content.filter(c => c.createdAt >= dayStart && c.createdAt < dayEnd);
    const dayQual = dayItems.filter(c => c.verdict === "quality").length;
    const dayTotal = dayItems.length;
    dailyQuality.push(dayTotal > 0 ? Math.round((dayQual / dayTotal) * 100) : 0);
    dailySlop.push(dayItems.filter(c => c.verdict === "slop").length);
  }

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: mobile ? 20 : 28 }}>
        <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0, letterSpacing: -0.5 }}>Aegis Dashboard</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Real-time information defense</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? 10 : 14, marginBottom: mobile ? 18 : 24 }}>
        <StatCard icon={<ShieldIcon s={16} />} label="Protected" value={qual.length} sub={`of ${content.length}`} color="#34d399" mobile={mobile} />
        <StatCard icon={<FireIcon s={16} />} label="Burned" value={slop.length} sub="slop eliminated" color="#f87171" mobile={mobile} />
        <StatCard icon={<ZapIcon s={16} />} label="Evaluated" value={content.length} sub="total items" color="#a78bfa" mobile={mobile} />
        <StatCard icon={<RSSIcon s={16} />} label="Sources" value={uniqueSources.size} sub="active feeds" color="#38bdf8" mobile={mobile} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 12 : 16, marginBottom: mobile ? 18 : 24 }}>
        {[
          { t: "Filter Accuracy (7d)", d: dailyQuality, c: "#34d399" },
          { t: "Slop Volume (7d)", d: dailySlop, c: "#f87171" },
        ].map(ch => (
          <div key={ch.t} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: mobile ? 16 : 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>{ch.t}</div>
            <MiniChart data={ch.d} color={ch.c} h={mobile ? 40 : 50} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 9, color: "#64748b" }}>
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>Latest Quality</div>
      {qual.slice(0, 3).map(it => (
        <ContentCard key={it.id} item={it} expanded={false} onToggle={() => {}} onValidate={() => {}} onFlag={() => {}} mobile={mobile} />
      ))}
    </div>
  );
};
