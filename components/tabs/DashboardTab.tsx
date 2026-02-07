"use client";
import React from "react";
import { ShieldIcon, FireIcon, ZapIcon, RSSIcon } from "@/components/icons";
import { StatCard } from "@/components/ui/StatCard";
import { MiniChart } from "@/components/ui/MiniChart";
import { QualityCard } from "@/components/ui/QualityCard";
import type { ContentItem } from "@/lib/types/content";

interface DashboardTabProps {
  content: ContentItem[];
  mobile?: boolean;
  procCnt: number;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ content, mobile, procCnt }) => {
  const qual = content.filter(c => c.verdict === "quality");
  const slop = content.filter(c => c.verdict === "slop");

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: mobile ? 20 : 28 }}>
        <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0, letterSpacing: -0.5 }}>Aegis Dashboard</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Real-time information defense</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? 10 : 14, marginBottom: mobile ? 18 : 24 }}>
        <StatCard icon={<ShieldIcon s={16} />} label="Protected" value={qual.length} sub={`of ${content.length}`} color="#34d399" mobile={mobile} />
        <StatCard icon={<FireIcon s={16} />} label="Burned" value={slop.length} sub="slop eliminated" color="#f87171" mobile={mobile} />
        <StatCard icon={<ZapIcon s={16} />} label="Evaluated" value={content.length} sub={`${248 + procCnt} total`} color="#a78bfa" mobile={mobile} />
        <StatCard icon={<RSSIcon s={16} />} label="Sources" value={4} sub="active feeds" color="#38bdf8" mobile={mobile} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 12 : 16, marginBottom: mobile ? 18 : 24 }}>
        {[
          { t: "Filter Accuracy (7d)", d: [82, 85, 84, 88, 87, 91, 93], c: "#34d399" },
          { t: "Slop Volume", d: [45, 52, 38, 61, 44, 35, 29], c: "#f87171" },
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
        <QualityCard key={it.id} item={it} expanded={false} onToggle={() => {}} onValidate={() => {}} onFlag={() => {}} mobile={mobile} />
      ))}
    </div>
  );
};
