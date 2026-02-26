"use client";
import React, { useState } from "react";
import { fonts, colors, space, type as t, shadows, radii, transitions, scoreGrade } from "@/styles/theme";
import { ScoreBar } from "./ScoreBar";
import { Tooltip } from "./Tooltip";
import { GLOSSARY } from "@/lib/glossary";
import { CheckIcon, XCloseIcon } from "@/components/icons";
import { D2ABadge } from "@/components/ui/D2ABadge";
import { isD2AContent } from "@/lib/d2a/activity";
import type { ContentItem } from "@/lib/types/content";

type CardVariant = "default" | "priority" | "serendipity";

function hasVCL(item: ContentItem): boolean {
  return item.vSignal !== undefined && item.cContext !== undefined && item.lSlop !== undefined;
}

interface ContentCardProps {
  item: ContentItem;
  expanded: boolean;
  onToggle: () => void;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  mobile?: boolean;
  variant?: CardVariant;
  rank?: number;
  focused?: boolean;
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

export function ScoreGrid({ item }: { item: ContentItem }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: space[3], marginBottom: space[4] }}>
      {hasVCL(item) ? (
        <>
          <Tooltip text={GLOSSARY["V-Signal"]} position="bottom"><ScoreBar label="V Signal" score={item.vSignal!} color={colors.purple[400]} /></Tooltip>
          <Tooltip text={GLOSSARY["C-Context"]} position="bottom"><ScoreBar label="C Context" score={item.cContext!} color={colors.sky[400]} /></Tooltip>
          <Tooltip text={GLOSSARY["L-Slop"]} position="bottom"><ScoreBar label="L Slop" score={item.lSlop!} color={colors.red[400]} /></Tooltip>
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

export function TopicTags({ topics, max = 3 }: { topics: string[]; max?: number }) {
  if (topics.length === 0) return null;
  const visible = topics.slice(0, max);
  const overflow = topics.length - max;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: space[2] }}>
      {visible.map(tp => (
        <span key={tp} style={{
          fontSize: t.caption.size, padding: "3px 10px", borderRadius: radii.pill,
          background: `${colors.purple[400]}15`, color: colors.purple[400], fontWeight: 600,
        }}>{tp}</span>
      ))}
      {overflow > 0 && (
        <span style={{
          fontSize: t.caption.size, padding: "3px 10px", borderRadius: radii.pill,
          background: `${colors.text.disabled}10`, color: colors.text.disabled, fontWeight: 600,
        }}>+{overflow}</span>
      )}
    </div>
  );
}

export function deriveScoreTags(item: ContentItem): Array<{ label: string; color: string }> {
  const tags: Array<{ label: string; color: string }> = [];

  if (hasVCL(item)) {
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

export const ContentCard: React.FC<ContentCardProps> = ({ item, expanded, onToggle, onValidate, onFlag, mobile, variant = "default", rank, focused }) => {
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
      id={`card-${item.id}`}
      data-source-url={item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) ? item.sourceUrl : undefined}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
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
        outline: focused ? `2px solid ${colors.cyan[400]}` : "none",
        outlineOffset: focused ? 1 : undefined,
      }}
    >
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

      {variant === "serendipity" && (
        <Tooltip text={GLOSSARY["Serendipity"]} position="bottom">
          <div style={{
            position: "absolute", top: 0, right: 0,
            background: `linear-gradient(135deg, ${colors.purple[600]}, ${colors.blue[600]})`,
            padding: `${space[1]}px ${space[4]}px ${space[1]}px 18px`, borderBottomLeftRadius: radii.md,
            fontSize: t.caption.size, fontWeight: 700, color: "#fff", letterSpacing: 0.5,
          }}>
            SERENDIPITY
          </div>
        </Tooltip>
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap",
        paddingBottom: space[2],
        borderBottom: `1px solid ${colors.border.subtle}`,
        marginBottom: space[2],
        ...(variant === "serendipity" ? { marginTop: space[1] } : {}),
      }}>
        {item.avatar?.startsWith("http") ? (
          /* eslint-disable-next-line @next/next/no-img-element -- Nostr profile avatar */
          <img
            src={item.avatar}
            alt=""
            style={{
              width: isLarge ? 22 : 20, height: isLarge ? 22 : 20,
              borderRadius: "50%", objectFit: "cover", flexShrink: 0,
              border: `1px solid ${colors.border.default}`,
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <span style={{ fontSize: isLarge ? 16 : 18 }}>{item.avatar}</span>
        )}
        <span style={{ fontWeight: 700, color: colors.text.secondary, fontSize: isLarge ? t.body.size : t.body.mobileSz, fontFamily: fonts.mono }}>{item.author}</span>
        <span style={{
          fontSize: t.caption.size, color: colors.text.muted,
          background: colors.bg.raised, padding: "2px 8px", borderRadius: radii.sm,
        }}>{item.platform || item.source}</span>
        {isD2AContent(item) && <D2ABadge mobile={mobile} />}
        {variant !== "serendipity" && <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>{item.timestamp}</span>}
        {variant === "priority" && <div style={{ flex: 1 }} />}
      </div>

      <div style={{ display: "flex", gap: mobile ? space[3] : space[4], alignItems: "flex-start" }}>
        {item.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- external user-content URLs */
          <img
            src={item.imageUrl}
            alt=""
            style={{
              width: isLarge ? 80 : 60,
              height: isLarge ? 80 : 60,
              objectFit: "cover",
              borderRadius: radii.sm,
              flexShrink: 0,
              border: `1px solid ${colors.border.default}`,
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
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

        {isLarge && (
          <div style={{ flexShrink: 0, marginTop: space[1] }}>
            <GradeBadge composite={item.scores.composite} />
          </div>
        )}
      </div>

      <ScoreTags item={item} />

      {item.topics && item.topics.length > 0 && (
        <TopicTags topics={item.topics} />
      )}

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
          <div style={{ display: "flex", gap: space[2] }}>
            {item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: `${space[2]}px ${space[3]}px`,
                  background: `${colors.blue[400]}10`,
                  border: `1px solid ${colors.blue[400]}30`,
                  borderRadius: radii.md,
                  color: colors.blue[400], fontSize: t.bodySm.size, fontWeight: 600,
                  textDecoration: "none", whiteSpace: "nowrap",
                  transition: transitions.fast, fontFamily: "inherit",
                }}
              >
                Read more &rarr;
              </a>
            )}
            {isSlop && !isLarge ? (
              <button disabled={item.validated} aria-label="Validate content" onClick={e => { e.stopPropagation(); onValidate(item.id); }} style={{
                flex: 1, padding: `${space[2]}px ${space[3]}px`,
                background: item.validated ? `${colors.green[400]}18` : colors.green.bg,
                border: `1px solid ${colors.green.border}`, borderRadius: radii.md,
                color: colors.green[400], fontSize: t.bodySm.size, fontWeight: 600,
                cursor: item.validated ? "default" : "pointer", opacity: item.validated ? 0.6 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                transition: transitions.fast, fontFamily: "inherit",
              }}>
                <CheckIcon /> {item.validated ? "Validated" : "Not Slop"}
              </button>
            ) : (
              <>
                <button disabled={item.validated} aria-label="Validate content" onClick={e => { e.stopPropagation(); onValidate(item.id); }} style={{
                  flex: 1, padding: `${space[2]}px ${space[3]}px`,
                  background: item.validated ? `${colors.green[400]}18` : colors.green.bg,
                  border: `1px solid ${colors.green.border}`, borderRadius: radii.md,
                  color: colors.green[400], fontSize: t.bodySm.size, fontWeight: 600,
                  cursor: item.validated ? "default" : "pointer", opacity: item.validated ? 0.6 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  transition: transitions.fast, fontFamily: "inherit",
                }}>
                  <CheckIcon /> {item.validated ? "Validated" : "Validate"}
                </button>
                <button disabled={item.flagged} aria-label="Flag as slop" onClick={e => { e.stopPropagation(); onFlag(item.id); }} style={{
                  flex: 1, padding: `${space[2]}px ${space[3]}px`,
                  background: item.flagged ? `${colors.red[400]}18` : colors.red.bg,
                  border: `1px solid ${colors.red.border}`, borderRadius: radii.md,
                  color: colors.red[400], fontSize: t.bodySm.size, fontWeight: 600,
                  cursor: item.flagged ? "default" : "pointer", opacity: item.flagged ? 0.6 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  transition: transitions.fast, fontFamily: "inherit",
                }}>
                  <XCloseIcon /> {item.flagged ? "Flagged" : "Flag Slop"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
