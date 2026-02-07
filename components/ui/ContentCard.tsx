"use client";
import React from "react";
import { fonts } from "@/styles/theme";
import { ScoreRing } from "./ScoreRing";
import { ScoreBar } from "./ScoreBar";
import { CheckIcon, XCloseIcon } from "@/components/icons";
import { scoreColor } from "@/lib/utils/scores";
import type { ContentItem } from "@/lib/types/content";

type CardVariant = "default" | "priority" | "serendipity";

interface ContentCardProps {
  item: ContentItem;
  expanded: boolean;
  onToggle: () => void;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  mobile?: boolean;
  variant?: CardVariant;
  rank?: number;
}

const variantStyles: Record<CardVariant, { bg: string; border: string; textColor: string; topicBg: string; topicColor: string }> = {
  default: {
    bg: "", // set dynamically based on verdict
    border: "",
    textColor: "#cbd5e1",
    topicBg: "rgba(139,92,246,0.12)",
    topicColor: "#a78bfa",
  },
  priority: {
    bg: "rgba(37,99,235,0.04)",
    border: "1px solid rgba(37,99,235,0.12)",
    textColor: "#cbd5e1",
    topicBg: "rgba(139,92,246,0.12)",
    topicColor: "#a78bfa",
  },
  serendipity: {
    bg: "linear-gradient(135deg, rgba(124,58,237,0.06), rgba(37,99,235,0.04))",
    border: "1px solid rgba(124,58,237,0.2)",
    textColor: "#d8b4fe",
    topicBg: "rgba(124,58,237,0.15)",
    topicColor: "#c4b5fd",
  },
};

function ScoreGrid({ item }: { item: ContentItem }) {
  const hasVCL = item.vSignal !== undefined && item.cContext !== undefined && item.lSlop !== undefined;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
      {hasVCL ? (
        <>
          <ScoreBar label="V Signal" score={item.vSignal!} color="#a78bfa" />
          <ScoreBar label="C Context" score={item.cContext!} color="#38bdf8" />
          <ScoreBar label="L Slop" score={item.lSlop!} color="#f87171" />
        </>
      ) : (
        <>
          <ScoreBar label="Originality" score={item.scores.originality} color="#818cf8" />
          <ScoreBar label="Insight" score={item.scores.insight} color="#38bdf8" />
          <ScoreBar label="Credibility" score={item.scores.credibility} color="#34d399" />
        </>
      )}
    </div>
  );
}

function TopicTags({ topics, bg, color }: { topics: string[]; bg: string; color: string }) {
  if (topics.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {topics.map(t => (
        <span key={t} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 12, background: bg, color, fontWeight: 600 }}>{t}</span>
      ))}
    </div>
  );
}

function ActionButtons({ item, onValidate, onFlag }: { item: ContentItem; onValidate: (id: string) => void; onFlag: (id: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={e => { e.stopPropagation(); onValidate(item.id); }} style={{
        flex: 1, padding: "9px 12px", background: "rgba(52,211,153,0.1)",
        border: "1px solid rgba(52,211,153,0.3)", borderRadius: 10,
        color: "#34d399", fontSize: 12, fontWeight: 600, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      }}>
        <CheckIcon /> Validate
      </button>
      <button onClick={e => { e.stopPropagation(); onFlag(item.id); }} style={{
        flex: 1, padding: "9px 12px", background: "rgba(248,113,113,0.1)",
        border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10,
        color: "#f87171", fontSize: 12, fontWeight: 600, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      }}>
        <XCloseIcon /> Flag Slop
      </button>
    </div>
  );
}

export const ContentCard: React.FC<ContentCardProps> = ({ item, expanded, onToggle, onValidate, onFlag, mobile, variant = "default", rank }) => {
  const isSlop = item.verdict === "slop";
  const sc = scoreColor(item.scores.composite);
  const vs = variantStyles[variant];

  const isLarge = variant === "priority" || variant === "serendipity";
  const pad = isLarge ? (mobile ? "16px 14px" : "20px 24px") : (mobile ? "14px 14px" : "16px 20px");

  const bg = variant === "default"
    ? (isSlop ? "rgba(248,113,113,0.04)" : "rgba(52,211,153,0.03)")
    : vs.bg;
  const border = variant === "default"
    ? `1px solid ${isSlop ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.08)"}`
    : vs.border;
  const borderLeft = variant === "serendipity" ? undefined : `${isLarge ? 4 : 3}px solid ${sc}`;

  return (
    <div onClick={onToggle} style={{
      background: bg, border, borderRadius: isLarge ? 16 : 14, padding: pad,
      cursor: "pointer", transition: "all 0.3s", marginBottom: isLarge ? 12 : 10,
      borderLeft, position: variant !== "default" ? "relative" : undefined,
      overflow: variant === "serendipity" ? "hidden" : undefined,
    }}>
      {/* Rank badge (priority) */}
      {variant === "priority" && rank !== undefined && (
        <div style={{
          position: "absolute", top: mobile ? 10 : 14, right: mobile ? 10 : 16,
          width: 28, height: 28, borderRadius: "50%",
          background: "linear-gradient(135deg, #2563eb, #7c3aed)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 800, color: "#fff",
        }}>
          {rank}
        </div>
      )}

      {/* Serendipity label */}
      {variant === "serendipity" && (
        <div style={{
          position: "absolute", top: 0, right: 0,
          background: "linear-gradient(135deg, #7c3aed, #2563eb)",
          padding: "4px 14px 4px 18px", borderBottomLeftRadius: 12,
          fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: 0.5,
        }}>
          SERENDIPITY
        </div>
      )}

      <div style={{ display: "flex", gap: mobile ? (isLarge ? 12 : 10) : (isLarge ? 16 : 14), alignItems: "flex-start", ...(variant === "serendipity" ? { marginTop: 4 } : {}) }}>
        {isLarge ? (
          <>
            <ScoreRing value={item.scores.composite} size={mobile ? 48 : 56} color={sc} />
            <div style={{ flex: 1, minWidth: 0, paddingRight: variant === "serendipity" ? 90 : 36 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 16 }}>{item.avatar}</span>
                <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14, fontFamily: fonts.mono }}>{item.author}</span>
                <span style={{ fontSize: 10, color: "#64748b", background: "#1e293b", padding: "2px 8px", borderRadius: 5 }}>{item.source}</span>
                {variant !== "serendipity" && <span style={{ fontSize: 10, color: "#64748b" }}>{item.timestamp}</span>}
              </div>
              <p style={{ color: vs.textColor, fontSize: mobile ? 13 : 15, lineHeight: 1.7, margin: 0, wordBreak: "break-word" }}>
                {item.text}
              </p>
              {variant === "serendipity" && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#a78bfa", fontStyle: "italic" }}>
                  Outside your usual topics — expanding your perspective
                </div>
              )}
              <TopicTags topics={item.topics || []} bg={vs.topicBg} color={vs.topicColor} />
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: isLarge ? 16 : 14, paddingTop: 14, borderTop: `1px solid ${variant === "serendipity" ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.06)"}` }}>
          <ScoreGrid item={item} />
          {variant === "default" && item.topics && item.topics.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {item.topics.map(t => (
                <span key={t} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: vs.topicBg, color: vs.topicColor, fontWeight: 600 }}>{t}</span>
              ))}
            </div>
          )}
          {item.reason && (
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, fontStyle: "italic", background: "rgba(0,0,0,0.2)", padding: "10px 14px", borderRadius: 10, marginBottom: 12 }}>
              {item.reason}
            </div>
          )}
          {(!isSlop || isLarge) && <ActionButtons item={item} onValidate={onValidate} onFlag={onFlag} />}
        </div>
      )}
    </div>
  );
};
