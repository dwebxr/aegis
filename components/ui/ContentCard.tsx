"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { colors, scoreGrade } from "@/styles/theme";
import { ScoreBar } from "./ScoreBar";
import {
  Tooltip as ShadTooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { GLOSSARY } from "@/lib/glossary";
import { CheckIcon } from "@/components/icons";
import { BookmarkIcon, ExternalLinkIcon, FlagIcon } from "@/components/icons/signal";
import { D2ABadge } from "@/components/ui/D2ABadge";
import { SignalBadge, labelToSignalType } from "@/components/ui/SignalBadge";
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
    <ShadTooltip>
      <TooltipTrigger asChild>
        <div
          className="w-11 h-[54px] rounded-sm flex items-center justify-center flex-col gap-px shrink-0"
          style={{
            background: bg,
            border: `2px solid ${color}40`,
            boxShadow: `0 0 12px ${color}30`,
          }}
          aria-label={`Grade ${grade}, score ${composite.toFixed(1)}`}
        >
          <span className="text-lg font-extrabold font-mono leading-none" style={{ color }}>{grade}</span>
          <span className="text-caption font-semibold font-mono leading-none opacity-85" style={{ color }}>{composite.toFixed(1)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">Composite score {composite.toFixed(1)} / 10</TooltipContent>
    </ShadTooltip>
  );
}

export function ScoreGrid({ item }: { item: ContentItem }) {
  return (
    <div data-testid="aegis-card-score-grid" className="grid grid-cols-3 gap-3 mb-4">
      {hasVCL(item) ? (
        <>
          <ShadTooltip><TooltipTrigger asChild><div><ScoreBar label="V" score={item.vSignal!} color={colors.purple[400]} /></div></TooltipTrigger><TooltipContent side="bottom">{GLOSSARY["V-Signal"]}</TooltipContent></ShadTooltip>
          <ShadTooltip><TooltipTrigger asChild><div><ScoreBar label="C" score={item.cContext!} color={colors.sky[400]} /></div></TooltipTrigger><TooltipContent side="bottom">{GLOSSARY["C-Context"]}</TooltipContent></ShadTooltip>
          <ShadTooltip><TooltipTrigger asChild><div><ScoreBar label="L" score={item.lSlop!} color={colors.red[400]} /></div></TooltipTrigger><TooltipContent side="bottom">{GLOSSARY["L-Slop"]}</TooltipContent></ShadTooltip>
        </>
      ) : (
        <>
          <ScoreBar label="Orig" score={item.scores.originality} color={colors.purple[500]} />
          <ScoreBar label="Ins" score={item.scores.insight} color={colors.sky[400]} />
          <ScoreBar label="Cred" score={item.scores.credibility} color={colors.green[400]} />
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
        <ShadTooltip>
          <TooltipTrigger asChild>
            <span className="text-caption px-2.5 py-[3px] rounded-full bg-muted-foreground/5 text-disabled font-semibold cursor-default">
              +{overflow}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {topics.slice(max).join(", ")}
          </TooltipContent>
        </ShadTooltip>
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

  return tags.slice(0, 3);
}

/** Icon-based signal badges replacing text ScoreTags */
function SignalBadges({ item }: { item: ContentItem }) {
  const tags = deriveScoreTags(item);
  if (tags.length === 0) return null;
  return (
    <div className="flex gap-1 flex-wrap mt-2">
      {tags.map(tag => {
        const signalType = labelToSignalType(tag.label);
        if (!signalType) return null;
        return <SignalBadge key={tag.label} type={signalType} />;
      })}
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

/** Tooltip-wrapped action button */
function ActionBtn({
  label,
  icon,
  showText,
  text,
  onClick,
  disabled,
  className,
  "data-testid": testId,
}: {
  label: string;
  icon: React.ReactNode;
  showText: boolean;
  text: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  className: string;
  "data-testid"?: string;
}) {
  const btn = (
    <button
      data-testid={testId}
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className={className}
    >
      {icon}{showText && ` ${text}`}
    </button>
  );

  if (showText) return btn;

  return (
    <ShadTooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </ShadTooltip>
  );
}

const ContentCardInner: React.FC<ContentCardProps> = ({ item, expanded, onToggle, onValidate, onFlag, onAddFilterRule, onBookmark, isBookmarked, mobile, variant = "default", rank, focused, clusterCount }) => {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isSlop = item.verdict === "slop";
  const gr = scoreGrade(item.scores.composite);

  const isLarge = variant === "priority" || variant === "serendipity";
  const compactBtns = mobile && !!(onBookmark || onAddFilterRule);
  const showActionText = expanded && !compactBtns;
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
        <ShadTooltip>
          <TooltipTrigger asChild>
            <div className="absolute top-0 right-0 bg-gradient-to-br from-purple-600 to-blue-600 py-1 pl-[18px] pr-4 rounded-bl-md text-caption font-bold text-white tracking-wide">
              {mobile ? "\u2728" : "\u2728 DISCOVERY"}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">{GLOSSARY["Serendipity"]}</TooltipContent>
        </ShadTooltip>
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
          <div className="float-right ml-3 mb-1 text-center">
            <GradeBadge composite={item.scores.composite} />
          </div>

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

      {/* Signal badges (icon-only, tooltip on hover) + topic tags */}
      <SignalBadges item={item} />

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
              <ShadTooltip>
                <TooltipTrigger asChild>
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Read source article"
                    className={cn(
                      actionBtnBase,
                      "bg-blue-400/[0.06] border border-blue-400/[0.19] text-blue-400 no-underline whitespace-nowrap",
                      compactBtns ? "p-2" : "px-3 py-2"
                    )}
                  >
                    <ExternalLinkIcon s={14} />{showActionText && " Read"}
                  </a>
                </TooltipTrigger>
                {!showActionText && <TooltipContent side="bottom">Read source article</TooltipContent>}
              </ShadTooltip>
            )}
            {onBookmark && (
              <ActionBtn
                label={isBookmarked ? "Remove bookmark" : "Bookmark for later"}
                icon={<BookmarkIcon s={14} />}
                showText={showActionText}
                text={isBookmarked ? "Saved" : "Save"}
                onClick={e => { e.stopPropagation(); onBookmark(item.id); }}
                className={cn(
                  actionBtnBase,
                  isBookmarked
                    ? "bg-amber-400/[0.09] border border-amber-400/[0.19] text-amber-400"
                    : "bg-transparent border border-border text-muted-foreground",
                  compactBtns ? "p-2" : "px-3 py-2"
                )}
              />
            )}
            <ActionBtn
              data-testid="aegis-card-validate"
              label="Validate content"
              icon={<CheckIcon />}
              showText={showActionText}
              text={item.validated ? "Validated" : isSlop && !isLarge ? "Not Slop" : "Validate"}
              disabled={item.validated}
              onClick={e => { e.stopPropagation(); onValidate(item.id); }}
              className={cn(
                actionBtnBase,
                "bg-emerald-dim border border-emerald-border text-emerald-400",
                item.validated && "opacity-60 cursor-default",
                !compactBtns && "flex-1",
                compactBtns ? "p-2" : "px-3 py-2"
              )}
            />
            {(!isSlop || isLarge) && (
              <ActionBtn
                data-testid="aegis-card-flag"
                label="Flag as slop"
                icon={<FlagIcon s={14} />}
                showText={showActionText}
                text={item.flagged ? "Flagged" : "Flag"}
                disabled={item.flagged}
                onClick={e => { e.stopPropagation(); onFlag(item.id); }}
                className={cn(
                  actionBtnBase,
                  "bg-red-dim border border-red-border text-red-400",
                  item.flagged && "opacity-60 cursor-default",
                  !compactBtns && "flex-1",
                  compactBtns ? "p-2" : "px-3 py-2"
                )}
              />
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
