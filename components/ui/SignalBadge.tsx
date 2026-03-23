"use client";
import React from "react";
import { cn } from "@/lib/utils";
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

const SIGNAL_CONFIG: Record<
  SignalType,
  { icon: React.FC<{ s?: number }>; label: string; tooltip: string; color: string }
> = {
  "high-signal": {
    icon: SignalIcon,
    label: "Signal",
    tooltip: "High signal — strong originality and unique insight",
    color: "#a78bfa", // purple-400
  },
  "rich-context": {
    icon: ContextIcon,
    label: "Context",
    tooltip: "Rich context — reliable sourcing and factual grounding",
    color: "#38bdf8", // sky-400
  },
  "low-noise": {
    icon: NoiseIcon,
    label: "Clean",
    tooltip: "Low noise — minimal AI filler, clickbait, or fluff",
    color: "#34d399", // green-400
  },
  "high-slop": {
    icon: SlopRiskIcon,
    label: "Slop risk",
    tooltip: "High slop risk — likely AI-generated filler or clickbait",
    color: "#f87171", // red-400
  },
  original: {
    icon: OriginalIcon,
    label: "Original",
    tooltip: "Highly original content with novel perspective",
    color: "#a78bfa",
  },
  insightful: {
    icon: InsightIcon,
    label: "Insight",
    tooltip: "Deep insight — provides meaningful analysis",
    color: "#38bdf8",
  },
  credible: {
    icon: CredibleIcon,
    label: "Credible",
    tooltip: "High credibility — well-sourced and factual",
    color: "#34d399",
  },
  "low-credibility": {
    icon: SlopRiskIcon,
    label: "Low cred",
    tooltip: "Low credibility — unverified or unreliable sourcing",
    color: "#f87171",
  },
  derivative: {
    icon: DerivativeIcon,
    label: "Derivative",
    tooltip: "Derivative — recycled content with little original value",
    color: "#fb923c", // orange-400
  },
};

interface SignalBadgeProps {
  type: SignalType;
  showLabel?: boolean;
}

export const SignalBadge: React.FC<SignalBadgeProps> = ({ type, showLabel = false }) => {
  const config = SIGNAL_CONFIG[type];
  const Icon = config.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-[2px] text-tiny font-semibold transition-colors duration-150",
            showLabel && "px-2",
          )}
          style={{
            background: `${config.color}12`,
            color: config.color,
            border: `1px solid ${config.color}20`,
          }}
          aria-label={config.tooltip}
        >
          <Icon s={12} />
          {showLabel && <span className="tracking-wide">{config.label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[220px]">
        {config.tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

/** Maps score tag labels from deriveScoreTags to SignalType */
export function labelToSignalType(label: string): SignalType | null {
  const map: Record<string, SignalType> = {
    "High signal": "high-signal",
    "Rich context": "rich-context",
    "Low noise": "low-noise",
    "High slop risk": "high-slop",
    "Original": "original",
    "Insightful": "insightful",
    "Credible": "credible",
    "Low credibility": "low-credibility",
    "Derivative": "derivative",
  };
  return map[label] ?? null;
}
