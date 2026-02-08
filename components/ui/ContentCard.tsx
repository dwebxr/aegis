"use client";
import React, { useState } from "react";
import { fonts, colors, space, type as t, shadows, radii, transitions, scoreGrade } from "@/styles/theme";
import { ScoreBar } from "./ScoreBar";
import { CheckIcon, XCloseIcon } from "@/components/icons";
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

function GradeBadge({ composite }: { composite: number }) {
  const { grade, color, bg } = scoreGrade(composite);
  return (
    <div style={{
      width: 44, height: 44, borderRadius: radii.sm,
      background: bg, border: `2px solid ${color}40`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
      boxShadow: `0 0 12px ${color}30`,
    }}>
      <span style={{ fontSize: 20, fontWeight: 800, color, fontFamily: fonts.mono }}>{grade}</span>
    </div>
  );
}

function ScoreGrid({ item }: { item: ContentItem }) {
  const hasVCL = item.vSignal !== undefined && item.cContext !== undefined && item.lSlop !== undefined;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: space[3], marginBottom: space[4] }}>
      {hasVCL ? (
        <>
          <ScoreBar label="V Signal" score={item.vSignal!} color={colors.purple[400]} />
          <ScoreBar label="C Context" score={item.cContext!} color={colors.sky[400]} />
          <ScoreBar label="L Slop" score={item.lSlop!} color={colors.red[400]} />
        </>
      ) : (
        <>
          <ScoreBar label="Originality" score={item.scores.originality} color={colors.purple[500]} />
          <ScoreBar label="Insight" score={item.scores.insight} color={colors.sky[400]} />
          <ScoreBar label="Credibility" score={item.scores.credibility} color={colors.green[400]} />
        </>
      )}
    </div>
  );
}

function TopicTags({ topics }: { topics: string[] }) {
  if (topics.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: space[2] }}>
      {topics.map(tp => (
        <span key={tp} style={{
          fontSize: t.caption.size, padding: "3px 10px", borderRadius: radii.pill,
          background: `${colors.purple[400]}15`, color: colors.purple[400], fontWeight: 600,
        }}>{tp}</span>
      ))}
    </div>
  );
}

function RestoreButton({ item, onValidate }: { item: ContentItem; onValidate: (id: string) => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onValidate(item.id); }} style={{
      width: "100%", padding: `${space[2]}px ${space[3]}px`, background: colors.green.bg,
      border: `1px solid ${colors.green.border}`, borderRadius: radii.md,
      color: colors.green[400], fontSize: t.bodySm.size, fontWeight: 600, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      transition: transitions.fast, fontFamily: "inherit",
    }}>
      <CheckIcon /> Not Slop
    </button>
  );
}

function deriveScoreTags(item: ContentItem): Array<{ label: string; color: string }> {
  const tags: Array<{ label: string; color: string }> = [];
  const hasVCL = item.vSignal !== undefined && item.cContext !== undefined && item.lSlop !== undefined;

  if (hasVCL) {
    if (item.vSignal! >= 7) tags.push({ label: "High signal", color: colors.purple[400] });
    if (item.cContext! >= 7) tags.push({ label: "Rich context", color: colors.sky[400] });
    if (item.lSlop! >= 7) tags.push({ label: "High slop risk", color: colors.red[400] });
    if (item.lSlop! <= 2) tags.push({ label: "Low noise", color: colors.green[400] });
  } else {
    if (item.scores.originality >= 8) tags.push({ label: "Original", color: colors.purple[400] });
    if (item.scores.insight >= 8) tags.push({ label: "Insightful", color: colors.sky[400] });
    if (item.scores.credibility >= 8) tags.push({ label: "Credible", color: colors.green[400] });
    if (item.scores.credibility <= 3) tags.push({ label: "Low credibility", color: colors.red[400] });
    if (item.scores.originality <= 2) tags.push({ label: "Derivative", color: colors.orange[400] });
  }

  return tags.slice(0, 2);
}

function ScoreTags({ item }: { item: ContentItem }) {
  const tags = deriveScoreTags(item);
  if (tags.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: space[2] }}>
      {tags.map(tag => (
        <span key={tag.label} style={{
          fontSize: t.tiny.size, fontWeight: t.tiny.weight, letterSpacing: t.tiny.letterSpacing,
          padding: "2px 8px", borderRadius: radii.pill,
          background: `${tag.color}12`, color: tag.color,
          border: `1px solid ${tag.color}20`, textTransform: "uppercase",
        }}>
          {tag.label}
        </span>
      ))}
    </div>
  );
}

function ActionButtons({ item, onValidate, onFlag }: { item: ContentItem; onValidate: (id: string) => void; onFlag: (id: string) => void }) {
  return (
    <div style={{ display: "flex", gap: space[2] }}>
      <button onClick={e => { e.stopPropagation(); onValidate(item.id); }} style={{
        flex: 1, padding: `${space[2]}px ${space[3]}px`, background: colors.green.bg,
        border: `1px solid ${colors.green.border}`, borderRadius: radii.md,
        color: colors.green[400], fontSize: t.bodySm.size, fontWeight: 600, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        transition: transitions.fast, fontFamily: "inherit",
      }}>
        <CheckIcon /> Validate
      </button>
      <button onClick={e => { e.stopPropagation(); onFlag(item.id); }} style={{
        flex: 1, padding: `${space[2]}px ${space[3]}px`, background: colors.red.bg,
        border: `1px solid ${colors.red.border}`, borderRadius: radii.md,
        color: colors.red[400], fontSize: t.bodySm.size, fontWeight: 600, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        transition: transitions.fast, fontFamily: "inherit",
      }}>
        <XCloseIcon /> Flag Slop
      </button>
    </div>
  );
}

export const ContentCard: React.FC<ContentCardProps> = ({ item, expanded, onToggle, onValidate, onFlag, mobile, variant = "default", rank }) => {
  const [hovered, setHovered] = useState(false);
  const isSlop = item.verdict === "slop";
  const gr = scoreGrade(item.scores.composite);

  const isLarge = variant === "priority" || variant === "serendipity";
  const pad = isLarge ? (mobile ? `${space[4]}px ${space[4]}px` : `${space[5]}px ${space[6]}px`) : (mobile ? `${space[4]}px ${space[4]}px` : `${space[4]}px ${space[5]}px`);

  const bg = variant === "serendipity"
    ? `linear-gradient(135deg, rgba(124,58,237,0.06), rgba(37,99,235,0.04))`
    : variant === "priority"
      ? `rgba(37,99,235,0.04)`
      : isSlop ? colors.red.bg : colors.green.bg;

  const border = variant === "serendipity"
    ? `1px solid rgba(124,58,237,0.2)`
    : variant === "priority"
      ? `1px solid rgba(37,99,235,0.12)`
      : `1px solid ${isSlop ? colors.red.border : colors.green.border}`;

  const borderLeft = variant === "serendipity" ? undefined : `${isLarge ? 4 : 3}px solid ${gr.color}`;

  const hoverShadow = isSlop ? shadows.glow.orange : shadows.md;

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: bg, border,
        borderRadius: isLarge ? radii.lg : radii.md, padding: pad,
        cursor: "pointer",
        transition: transitions.normal,
        marginBottom: isLarge ? space[3] : space[2],
        borderLeft,
        position: variant !== "default" ? "relative" : undefined,
        overflow: variant === "serendipity" ? "hidden" : undefined,
        transform: hovered ? "scale(1.008)" : "scale(1)",
        boxShadow: hovered ? hoverShadow : "none",
      }}
    >
      {/* Priority rank badge */}
      {variant === "priority" && rank !== undefined && (
        <div style={{
          position: "absolute", top: mobile ? space[3] : space[4], right: mobile ? space[3] : space[4],
          width: 28, height: 28, borderRadius: "50%",
          background: `linear-gradient(135deg, ${colors.blue[600]}, ${colors.purple[600]})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: t.bodySm.size, fontWeight: 800, color: "#fff",
        }}>
          {rank}
        </div>
      )}

      {/* Serendipity ribbon */}
      {variant === "serendipity" && (
        <div style={{
          position: "absolute", top: 0, right: 0,
          background: `linear-gradient(135deg, ${colors.purple[600]}, ${colors.blue[600]})`,
          padding: `${space[1]}px ${space[4]}px ${space[1]}px 18px`, borderBottomLeftRadius: radii.md,
          fontSize: t.caption.size, fontWeight: 700, color: "#fff", letterSpacing: 0.5,
        }}>
          SERENDIPITY
        </div>
      )}

      {/* Zone 1: Author Info Bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap",
        paddingBottom: space[2],
        borderBottom: `1px solid ${colors.border.subtle}`,
        marginBottom: space[2],
        ...(variant === "serendipity" ? { marginTop: space[1] } : {}),
      }}>
        <span style={{ fontSize: isLarge ? 16 : 18 }}>{item.avatar}</span>
        <span style={{ fontWeight: 700, color: colors.text.secondary, fontSize: isLarge ? t.body.size : t.body.mobileSz, fontFamily: fonts.mono }}>{item.author}</span>
        <span style={{
          fontSize: t.caption.size, color: colors.text.muted,
          background: colors.bg.raised, padding: "2px 8px", borderRadius: radii.sm,
        }}>{item.source}</span>
        {variant !== "serendipity" && <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>{item.timestamp}</span>}
        {variant === "priority" && <div style={{ flex: 1 }} />}
      </div>

      {/* Zone 2: Body Content */}
      <div style={{ display: "flex", gap: mobile ? space[3] : space[4], alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: variant === "serendipity" ? 90 : (variant === "priority" ? 36 : 0) }}>
          <p style={{
            color: isSlop ? colors.text.tertiary : (variant === "serendipity" ? "#d8b4fe" : colors.text.tertiary),
            fontSize: mobile ? t.body.mobileSz : (isLarge ? t.bodyLg.size : t.body.size),
            lineHeight: isLarge ? t.bodyLg.lineHeight : t.body.lineHeight,
            margin: 0,
            textDecoration: isSlop && !isLarge ? "line-through" : "none",
            opacity: isSlop && !isLarge ? 0.5 : 1,
            wordBreak: "break-word",
          }}>
            {item.text}
          </p>
          {variant === "serendipity" && (
            <div style={{ marginTop: space[2], fontSize: t.caption.size, color: colors.purple[400], fontStyle: "italic" }}>
              Outside your usual topics — expanding your perspective
            </div>
          )}
        </div>

        {/* Score badge (non-large cards) */}
        {!isLarge && (
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <GradeBadge composite={item.scores.composite} />
            <div style={{
              marginTop: space[1], fontSize: t.tiny.size, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: 1,
              color: isSlop ? colors.red[400] : colors.green[400],
            }}>
              {item.verdict}
            </div>
          </div>
        )}

        {/* Score badge (large cards) */}
        {isLarge && (
          <div style={{ flexShrink: 0, marginTop: space[1] }}>
            <GradeBadge composite={item.scores.composite} />
          </div>
        )}
      </div>

      {/* Score indicator tags (always visible) */}
      <ScoreTags item={item} />

      {/* Zone 3: Topic tags (always visible) */}
      {item.topics && item.topics.length > 0 && (
        <TopicTags topics={item.topics} />
      )}

      {/* Expanded details */}
      {expanded && (
        <div style={{
          marginTop: space[4],
          paddingTop: space[4],
          borderTop: `1px solid ${variant === "serendipity" ? "rgba(124,58,237,0.15)" : colors.border.default}`,
        }}>
          <ScoreGrid item={item} />
          {item.reason && (
            <div style={{
              fontSize: t.bodySm.size, color: colors.text.tertiary, lineHeight: 1.5, fontStyle: "italic",
              background: colors.bg.raised, padding: `${space[3]}px ${space[4]}px`, borderRadius: radii.md, marginBottom: space[3],
            }}>
              {item.reason}
            </div>
          )}
          {isSlop && !isLarge && <RestoreButton item={item} onValidate={onValidate} />}
          {(!isSlop || isLarge) && <ActionButtons item={item} onValidate={onValidate} onFlag={onFlag} />}
        </div>
      )}
    </div>
  );
};
