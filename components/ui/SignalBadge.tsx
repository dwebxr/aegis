"use client";
import React from "react";
import { colors } from "@/styles/theme";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  SignalIcon,
  ContextIcon,
  NoiseIcon,
  SlopRiskIcon,
  OriginalIcon,
  InsightIcon,
  CredibleIcon,
  DerivativeIcon,
} from "@/components/icons/signal";
import type { IconProps } from "@/components/icons/types";
import type { ContentItem } from "@/lib/types/content";

export type SignalType =
  | "high-signal"
  | "rich-context"
  | "low-noise"
  | "high-slop"
  | "original"
  | "insightful"
  | "credible"
  | "low-credibility"
  | "derivative";

const SIGNAL_CONFIG: Record<SignalType, { icon: React.FC<IconProps>; label: string; tooltip: string; color: string }> = {
  "high-signal": {
    icon: SignalIcon,
    label: "Signal",
    tooltip: "High signal — strong originality and unique insight",
    color: colors.purple[400],
  },
  "rich-context": {
    icon: ContextIcon,
    label: "Context",
    tooltip: "Rich context — reliable sourcing and factual grounding",
    color: colors.sky[400],
  },
  "low-noise": {
    icon: NoiseIcon,
    label: "Clean",
    tooltip: "Low noise — minimal AI filler, clickbait, or fluff",
    color: colors.green[400],
  },
  "high-slop": {
    icon: SlopRiskIcon,
    label: "Slop risk",
    tooltip: "High slop risk — likely AI-generated filler or clickbait",
    color: colors.red[400],
  },
  original: {
    icon: OriginalIcon,
    label: "Original",
    tooltip: "Highly original content with novel perspective",
    color: colors.purple[400],
  },
  insightful: {
    icon: InsightIcon,
    label: "Insight",
    tooltip: "Deep insight — provides meaningful analysis",
    color: colors.sky[400],
  },
  credible: {
    icon: CredibleIcon,
    label: "Credible",
    tooltip: "High credibility — well-sourced and factual",
    color: colors.green[400],
  },
  "low-credibility": {
    icon: SlopRiskIcon,
    label: "Low cred",
    tooltip: "Low credibility — unverified or unreliable sourcing",
    color: colors.red[400],
  },
  derivative: {
    icon: DerivativeIcon,
    label: "Derivative",
    tooltip: "Derivative — recycled content with little original value",
    color: colors.orange[400],
  },
};

interface SignalBadgeProps {
  type: SignalType;
  showLabel?: boolean;
}

export const SignalBadge: React.FC<SignalBadgeProps> = ({ type, showLabel = false }) => {
  const { icon: Icon, tooltip, color, label } = SIGNAL_CONFIG[type];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 rounded-full ${showLabel ? "px-2" : "px-1.5"} py-[2px] text-tiny font-semibold`}
          style={{ background: `${color}12`, color, border: `1px solid ${color}20` }}
          aria-label={tooltip}
        >
          <Icon s={12} />
          {showLabel && <span className="tracking-wide">{label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[220px]">{tooltip}</TooltipContent>
    </Tooltip>
  );
};

export function hasVCL(item: ContentItem): boolean {
  return item.vSignal !== undefined && item.cContext !== undefined && item.lSlop !== undefined;
}

const TAG_LABELS: Record<SignalType, string> = {
  "high-signal": "High signal", "rich-context": "Rich context", "low-noise": "Low noise",
  "high-slop": "High slop risk", "original": "Original", "insightful": "Insightful",
  "credible": "Credible", "low-credibility": "Low credibility", "derivative": "Derivative",
};

export function signalTypeToTag(type: SignalType): { label: string; color: string } {
  return { label: TAG_LABELS[type], color: SIGNAL_CONFIG[type].color };
}

/** Derive applicable SignalTypes directly from content scores */
export function deriveSignalTypes(item: ContentItem): SignalType[] {
  const types: SignalType[] = [];

  if (hasVCL(item)) {
    if (item.vSignal! >= 7) types.push("high-signal");
    if (item.cContext! >= 7) types.push("rich-context");
    if (item.lSlop! >= 7) types.push("high-slop");
    if (item.lSlop! <= 2) types.push("low-noise");
  } else {
    if (item.scores.originality >= 8) types.push("original");
    if (item.scores.insight >= 8) types.push("insightful");
    if (item.scores.credibility >= 8) types.push("credible");
    if (item.scores.credibility <= 3) types.push("low-credibility");
    if (item.scores.originality <= 2) types.push("derivative");
  }

  return types.slice(0, 3);
}
