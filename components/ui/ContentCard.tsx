"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { colors, scoreGrade } from "@/styles/theme";
import { ScoreBar } from "./ScoreBar";
import { Tooltip } from "./LegacyTooltip";
import { GLOSSARY } from "@/lib/glossary";
import { CheckIcon, XCloseIcon } from "@/components/icons";
import { D2ABadge } from "@/components/ui/D2ABadge";
import { isD2AContent } from "@/lib/d2a/activity";
import { extractYouTubeVideoId } from "@/lib/utils/youtube";
import type { ContentItem } from "@/lib/types/content";
import type { CustomFilterRule } from "@/lib/preferences/types";

type CardVariant = "default" | "priority" | "serendipity";

function hasVCL(item: ContentItem): boolean {
  return item.vSignal !== undefined && item.cContext !== undefined && item.lSlop !== undefined;
}

interface ContentCardProps {
  item: ContentItem;
  expanded: boolean;
  onToggle: (id: string) => void;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  onAddFilterRule?: (rule: Omit<CustomFilterRule, "id" | "createdAt">) => void;
  onBookmark?: (id: string) => void;
  isBookmarked?: boolean;
  mobile?: boolean;
  variant?: CardVariant;
  rank?: number;
  focused?: boolean;
  clusterCount?: number;
}

function GradeBadge({ composite }: { composite: number }) {
  const { grade, color, bg } = scoreGrade(composite);
  return (
    <div
      className="w-11 h-[54px] rounded-sm flex items-center justify-center flex-col gap-px shrink-0"
      style={{
        background: bg,
        border: `2px solid ${color}40`,
        boxShadow: `0 0 12px ${color}30`,
      }}
    >
      <span className="text-lg font-extrabold font-mono leading-none" style={{ color }}>{grade}</span>
      <span className="text-caption font-semibold font-mono leading-none opacity-85" style={{ color }}>{composite.toFixed(1)}</span>
    </div>
  );
}

export function ScoreGrid({ item }: { item: ContentItem }) {
  return (
    <div data-testid="aegis-card-score-grid" className="grid grid-cols-3 gap-3 mb-4">
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
    <div className="flex gap-1.5 flex-wrap mt-2">
      {visible.map(tp => (
        <span
          key={tp}
          className="text-caption px-2.5 py-[3px] rounded-full bg-purple-400/[0.08] text-purple-400 font-semibold"
        >
          {tp}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-caption px-2.5 py-[3px] rounded-full bg-muted-foreground/5 text-disabled font-semibold">
          +{overflow}
        </span>
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
    <div className="flex gap-1 flex-wrap mt-2">
      {tags.map(tag => (
        <span
          key={tag.label}
          className="text-tiny font-semibold tracking-wide px-2 py-[2px] rounded-full uppercase"
          style={{
            background: `${tag.color}12`,
            color: tag.color,
            border: `1px solid ${tag.color}20`,
          }}
        >
          {tag.label}
        </span>
      ))}
    </div>
  );
}

export function YouTubePreview({ sourceUrl }: { sourceUrl?: string }) {
  const [playing, setPlaying] = useState(false);
  const videoId = sourceUrl ? extractYouTubeVideoId(sourceUrl) : null;
  if (!videoId) return null;

  return (
    <div
      className="mt-3 w-full max-w-[360px] aspect-video rounded-md overflow-hidden relative border border-border"
      onClick={(e) => e.stopPropagation()}
    >
      {playing ? (
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          title="YouTube video"
          className="w-full h-full border-none block"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          className="w-full h-full cursor-pointer bg-transparent border-none p-0 m-0 relative block"
          onClick={() => setPlaying(true)}
          aria-label="Play YouTube video"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail */}
          <img
            src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
            alt=""
            className="w-full h-full object-cover block"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors hover:bg-black/20">
            <svg width="48" height="48" viewBox="0 0 68 48" className="drop-shadow-lg">
              <path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#FF0000"/>
              <path d="M45 24L27 14v20" fill="#fff"/>
            </svg>
          </div>
        </button>
      )}
    </div>
  );
}

const actionBtnBase = "flex items-center justify-center gap-[5px] rounded-md text-body-sm font-semibold cursor-pointer transition-all duration-150 font-[inherit] min-w-8";

const ContentCardInner: React.FC<ContentCardProps> = ({ item, expanded, onToggle, onValidate, onFlag, onAddFilterRule, onBookmark, isBookmarked, mobile, variant = "default", rank, focused, clusterCount }) => {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isSlop = item.verdict === "slop";
  const gr = scoreGrade(item.scores.composite);

  const isLarge = variant === "priority" || variant === "serendipity";
  const padCls = isLarge
    ? (mobile ? "p-4" : "px-6 py-5")
    : (mobile ? "p-4" : "px-5 py-4");

  return (
    <div
      id={`card-${item.id}`}
      data-testid="aegis-content-card"
      data-source-url={item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) ? item.sourceUrl : undefined}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => onToggle(item.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(item.id); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        padCls,
        "cursor-pointer transition-all duration-250 ease-out",
        isLarge ? "rounded-lg mb-3" : "rounded-md mb-2",
        variant !== "default" && "relative",
        variant === "serendipity" && "overflow-hidden",
        focused && "outline-2 outline-cyan-400 outline-offset-1",
        /* Variant backgrounds */
        variant === "serendipity" && "bg-gradient-to-br from-purple-600/[0.06] to-blue-600/[0.04] border border-purple-600/20",
        variant === "priority" && "bg-blue-600/[0.04] border border-blue-600/[0.12]",
        variant === "default" && (isSlop ? "bg-red-dim border border-red-border" : "bg-emerald-dim border border-emerald-border"),
      )}
      style={{
        borderLeft: variant !== "serendipity" ? `${isLarge ? 4 : 3}px solid ${gr.color}` : undefined,
        transform: hovered ? "scale(1.008)" : "scale(1)",
        boxShadow: hovered ? (isSlop ? "0 0 20px rgba(249,115,22,0.2)" : "0 4px 12px rgba(0,0,0,0.4)") : "none",
      }}
    >
      {/* Priority rank badge */}
      {variant === "priority" && rank !== undefined && (
        <div className={cn(
          "absolute size-7 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-body-sm font-extrabold text-white",
          mobile ? "top-3 right-3" : "top-4 right-4"
        )}>
          {rank}
        </div>
      )}

      {/* Serendipity ribbon */}
      {variant === "serendipity" && (
        <Tooltip text={GLOSSARY["Serendipity"]} position="bottom">
          <div className="absolute top-0 right-0 bg-gradient-to-br from-purple-600 to-blue-600 py-1 pl-[18px] pr-4 rounded-bl-md text-caption font-bold text-white tracking-wide">
            SERENDIPITY
          </div>
        </Tooltip>
      )}

      {/* Header row */}
      <div className={cn(
        "flex items-center gap-2 flex-wrap pb-2 border-b border-subtle mb-2",
        variant === "serendipity" && "mt-1"
      )}>
        {item.avatar?.startsWith("http") ? (
          /* eslint-disable-next-line @next/next/no-img-element -- Nostr profile avatar */
          <img
            src={item.avatar}
            alt=""
            className={cn(
              "rounded-full object-cover shrink-0 border border-border",
              isLarge ? "size-[22px]" : "size-5"
            )}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <span className={isLarge ? "text-base" : "text-lg"}>{item.avatar}</span>
        )}
        <span className={cn("font-bold text-secondary-foreground font-mono", isLarge ? "text-body" : "text-[13px]")}>{item.author}</span>
        <span className="text-caption text-muted-foreground bg-navy-lighter px-2 py-0.5 rounded-sm">{item.platform || item.source}</span>
        {isD2AContent(item) && <D2ABadge mobile={mobile} />}
        {variant !== "serendipity" && <span className="text-caption text-disabled">{item.timestamp}</span>}
        {variant === "priority" && <div className="flex-1" />}
      </div>

      {/* Body + grade */}
      <div className={cn(item.imageUrl && "flex gap-3 items-start")}>
        {item.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- external user-content URLs */
          <img
            src={item.imageUrl}
            alt=""
            className={cn(
              "object-cover rounded-sm shrink-0 border border-border",
              isLarge ? "size-20" : "size-15"
            )}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="min-w-0 flow-root">
          {/* Grade badge floated right — flow-root on parent establishes BFC to contain the float without clipping box-shadow */}
          {!isLarge && (
            <div className="float-right ml-3 mb-1 text-center">
              <GradeBadge composite={item.scores.composite} />
              <div className={cn(
                "mt-1 text-tiny font-bold uppercase tracking-[1px]",
                isSlop ? "text-red-400" : "text-emerald-400"
              )}>
                {item.verdict}
              </div>
            </div>
          )}
          {isLarge && (
            <div className="float-right ml-3 mb-1">
              <GradeBadge composite={item.scores.composite} />
            </div>
          )}

          <p className={cn(
            "m-0 break-words",
            isSlop && !isLarge && "line-through opacity-50",
            variant === "serendipity" ? "text-purple-300" : "text-tertiary",
            isLarge ? "text-[16px] leading-[1.35]" : "text-body-lg leading-body-lg",
          )}>
            {item.text}
          </p>
          {variant === "serendipity" && (
            <div className="mt-2 text-caption text-purple-400 italic">
              Outside your usual topics — expanding your perspective
            </div>
          )}
        </div>
      </div>

      <YouTubePreview sourceUrl={item.sourceUrl} />

      <ScoreTags item={item} />

      {item.topics && item.topics.length > 0 && (
        <TopicTags topics={item.topics} />
      )}

      {/* Cluster count */}
      {clusterCount !== undefined && clusterCount > 0 && !expanded && (
        <div className="inline-flex items-center gap-1 mt-2 px-2.5 py-0.5 rounded-full bg-blue-400/[0.07] text-blue-400 text-caption font-semibold border border-blue-400/[0.12]">
          +{clusterCount} related
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className={cn(
          "mt-4 pt-4 border-t",
          variant === "serendipity" ? "border-purple-600/15" : "border-border"
        )}>
          <ScoreGrid item={item} />
          {item.reason && (
            <div data-testid="aegis-card-reason" className="text-body-sm text-tertiary leading-body-sm italic bg-navy-lighter px-4 py-3 rounded-md mb-3">
              {item.reason}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  actionBtnBase,
                  "bg-blue-400/[0.06] border border-blue-400/[0.19] text-blue-400 no-underline whitespace-nowrap",
                  mobile ? "p-2" : "px-3 py-2"
                )}
              >
                {mobile ? "\u2197" : <>Read more &rarr;</>}
              </a>
            )}
            {onBookmark && (
              <button
                aria-label={isBookmarked ? "Remove bookmark" : "Bookmark for later"}
                onClick={e => { e.stopPropagation(); onBookmark(item.id); }}
                className={cn(
                  actionBtnBase,
                  isBookmarked
                    ? "bg-amber-400/[0.09] border border-amber-400/[0.19] text-amber-400"
                    : "bg-transparent border border-border text-muted-foreground",
                  mobile ? "p-2" : "px-3 py-2"
                )}
              >
                {mobile ? "\uD83D\uDD16" : (isBookmarked ? "\uD83D\uDD16 Saved" : "\uD83D\uDD16 Save")}
              </button>
            )}
            <button
              data-testid="aegis-card-validate"
              disabled={item.validated}
              aria-label="Validate content"
              onClick={e => { e.stopPropagation(); onValidate(item.id); }}
              className={cn(
                actionBtnBase,
                "bg-emerald-dim border border-emerald-border text-emerald-400",
                item.validated && "opacity-60 cursor-default",
                !mobile && "flex-1",
                mobile ? "p-2" : "px-3 py-2"
              )}
            >
              <CheckIcon />{!mobile && (item.validated ? " Validated" : isSlop && !isLarge ? " Not Slop" : " Validate")}
            </button>
            {(!isSlop || isLarge) && (
              <button
                data-testid="aegis-card-flag"
                disabled={item.flagged}
                aria-label="Flag as slop"
                onClick={e => { e.stopPropagation(); onFlag(item.id); }}
                className={cn(
                  actionBtnBase,
                  "bg-red-dim border border-red-border text-red-400",
                  item.flagged && "opacity-60 cursor-default",
                  !mobile && "flex-1",
                  mobile ? "p-2" : "px-3 py-2"
                )}
              >
                <XCloseIcon />{!mobile && (item.flagged ? " Flagged" : " Flag Slop")}
              </button>
            )}
            {onAddFilterRule && (
              <div className="relative">
                <button
                  aria-label="More actions"
                  onClick={e => { e.stopPropagation(); setMenuOpen(prev => !prev); }}
                  className={cn(
                    "p-2 border border-border rounded-md text-muted-foreground text-body font-bold cursor-pointer transition-all duration-150 font-[inherit] leading-none min-w-8 flex items-center justify-center",
                    menuOpen && "bg-muted-foreground/[0.07]"
                  )}
                >
                  &#x22EE;
                </button>
                {menuOpen && (
                  <div className="absolute bottom-full right-0 mb-1 bg-navy-lighter border border-border rounded-md shadow-md z-10 min-w-[160px] overflow-hidden">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onAddFilterRule({ field: "author", pattern: item.author });
                        setMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 bg-transparent border-none rounded-none text-red-400 text-body-sm font-semibold cursor-pointer text-left font-[inherit] transition-all duration-150 hover:bg-red-dim"
                    >
                      Block {item.author}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const ContentCard = React.memo(ContentCardInner);
