"use client";
import React from "react";
import { cn } from "@/lib/utils";
import type { DiscoveryType } from "@/lib/filtering/serendipity";

interface SerendipityBadgeProps {
  discoveryType: DiscoveryType;
  mobile?: boolean;
}

const BADGE_CONFIG: Record<DiscoveryType, { emoji: string; label: string; colorClass: string }> = {
  out_of_network: {
    emoji: "\uD83D\uDD2D",
    label: "OUT OF NETWORK",
    colorClass: "text-purple-400 bg-purple-400/10 border-purple-400/[0.12]",
  },
  cross_language: {
    emoji: "\uD83C\uDF10",
    label: "CROSS-LANGUAGE",
    colorClass: "text-sky-400 bg-sky-400/10 border-sky-400/[0.12]",
  },
  emerging_topic: {
    emoji: "\uD83C\uDF31",
    label: "EMERGING TOPIC",
    colorClass: "text-green-400 bg-green-400/10 border-green-400/[0.12]",
  },
};

export const SerendipityBadge: React.FC<SerendipityBadgeProps> = ({ discoveryType, mobile }) => {
  const cfg = BADGE_CONFIG[discoveryType];
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-px rounded-full border text-[9px] font-bold tracking-[0.05em] uppercase",
      cfg.colorClass
    )}>
      <span>{cfg.emoji}</span>
      {!mobile && cfg.label}
    </span>
  );
};
