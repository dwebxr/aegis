"use client";
import React from "react";
import { fonts } from "@/styles/theme";
import { ScoreRing } from "./ScoreRing";
import { ScoreBar } from "./ScoreBar";
import { CheckIcon, XCloseIcon } from "@/components/icons";
import { scoreColor } from "@/lib/utils/scores";
import type { ContentItem } from "@/lib/types/content";

interface QualityCardProps {
  item: ContentItem;
  expanded: boolean;
  onToggle: () => void;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  mobile?: boolean;
}

export const QualityCard: React.FC<QualityCardProps> = ({ item, expanded, onToggle, onValidate, onFlag, mobile }) => {
  const isSlop = item.verdict === "slop";
  const sc = scoreColor(item.scores.composite);

  return (
    <div onClick={onToggle} style={{
      background: isSlop ? "rgba(248,113,113,0.04)" : "rgba(52,211,153,0.03)",
      border: `1px solid ${isSlop ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.08)"}`,
      borderRadius: 14, padding: mobile ? "14px 14px" : "16px 20px", cursor: "pointer",
      transition: "all 0.3s", marginBottom: 10, borderLeft: `3px solid ${sc}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: mobile ? 10 : 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18 }}>{item.avatar}</span>
            <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 13, fontFamily: fonts.mono }}>{item.author}</span>
            <span style={{ fontSize: 10, color: "#64748b", background: "#1e293b", padding: "2px 6px", borderRadius: 5 }}>{item.source}</span>
            <span style={{ fontSize: 10, color: "#64748b" }}>{item.timestamp}</span>
          </div>
          <p style={{ color: isSlop ? "#94a3b8" : "#cbd5e1", fontSize: mobile ? 13 : 14, lineHeight: 1.6, margin: 0, textDecoration: isSlop ? "line-through" : "none", opacity: isSlop ? 0.5 : 1, wordBreak: "break-word" }}>
            {item.text}
          </p>
        </div>
        <div style={{ textAlign: "center" }}>
          <ScoreRing value={item.scores.composite} size={mobile ? 42 : 50} color={sc} />
          <div style={{ marginTop: 4, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: isSlop ? "#f87171" : "#34d399" }}>
            {item.verdict}
          </div>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <ScoreBar label="Originality" score={item.scores.originality} color="#818cf8" />
            <ScoreBar label="Insight" score={item.scores.insight} color="#38bdf8" />
            <ScoreBar label="Credibility" score={item.scores.credibility} color="#34d399" />
          </div>
          {item.reason && (
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, fontStyle: "italic", background: "rgba(0,0,0,0.2)", padding: "9px 12px", borderRadius: 9, marginBottom: 12 }}>
              {item.reason}
            </div>
          )}
          {!isSlop && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={e => { e.stopPropagation(); onValidate(item.id); }} style={{ flex: 1, padding: "8px 12px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 10, color: "#34d399", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <CheckIcon /> Validate
              </button>
              <button onClick={e => { e.stopPropagation(); onFlag(item.id); }} style={{ flex: 1, padding: "8px 12px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <XCloseIcon /> Flag Slop
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
