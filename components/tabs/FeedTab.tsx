"use client";
import React, { useState } from "react";
import { QualityCard } from "@/components/ui/QualityCard";
import type { ContentItem } from "@/lib/types/content";

interface FeedTabProps {
  content: ContentItem[];
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  mobile?: boolean;
}

export const FeedTab: React.FC<FeedTabProps> = ({ content, onValidate, onFlag, mobile }) => {
  const [filter, setFilter] = useState<"quality" | "slop" | "all">("quality");
  const [expanded, setExpanded] = useState<string | null>(null);

  const qual = content.filter(c => c.verdict === "quality");
  const slop = content.filter(c => c.verdict === "slop");
  const shown = filter === "all" ? content : filter === "quality" ? qual : slop;

  const filters: Array<["quality" | "slop" | "all", string, string, number]> = [
    ["quality", "Quality", "#34d399", qual.length],
    ["slop", "Slop", "#f87171", slop.length],
    ["all", "All", "#94a3b8", content.length],
  ];

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: mobile ? "flex-start" : "center", marginBottom: 20, flexDirection: mobile ? "column" : "row", gap: mobile ? 12 : 0 }}>
        <div>
          <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Content Feed</h1>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>AI-filtered information stream</p>
        </div>
        <div style={{ display: "flex", gap: 5, width: mobile ? "100%" : "auto" }}>
          {filters.map(([m, l, c, n]) => (
            <button key={m} onClick={() => setFilter(m)} style={{
              flex: mobile ? 1 : "none", padding: mobile ? "8px 10px" : "7px 16px",
              borderRadius: 9, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: filter === m ? `${c}18` : "rgba(255,255,255,0.03)",
              border: filter === m ? `1px solid ${c}40` : "1px solid rgba(255,255,255,0.06)",
              color: filter === m ? c : "#64748b", transition: "all .2s",
            }}>
              {l} ({n})
            </button>
          ))}
        </div>
      </div>

      {shown.map((it, i) => (
        <div key={it.id} style={{ animation: `slideUp .3s ease ${i * 0.04}s both` }}>
          <QualityCard
            item={it}
            expanded={expanded === it.id}
            onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
            onValidate={onValidate}
            onFlag={onFlag}
            mobile={mobile}
          />
        </div>
      ))}
    </div>
  );
};
