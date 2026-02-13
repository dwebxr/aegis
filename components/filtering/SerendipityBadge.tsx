"use client";
import React from "react";
import { colors, space, radii } from "@/styles/theme";
import type { DiscoveryType } from "@/lib/filtering/serendipity";

interface SerendipityBadgeProps {
  discoveryType: DiscoveryType;
  mobile?: boolean;
}

const BADGE_CONFIG: Record<DiscoveryType, { emoji: string; label: string; color: string; bg: string }> = {
  out_of_network: {
    emoji: "\uD83D\uDD2D",
    label: "OUT OF NETWORK",
    color: colors.purple[400],
    bg: "rgba(167,139,250,0.1)",
  },
  cross_language: {
    emoji: "\uD83C\uDF10",
    label: "CROSS-LANGUAGE",
    color: colors.sky[400],
    bg: "rgba(56,189,248,0.1)",
  },
  emerging_topic: {
    emoji: "\uD83C\uDF31",
    label: "EMERGING TOPIC",
    color: colors.green[400],
    bg: "rgba(52,211,153,0.1)",
  },
};

export const SerendipityBadge: React.FC<SerendipityBadgeProps> = ({ discoveryType, mobile }) => {
  const cfg = BADGE_CONFIG[discoveryType];
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: space[1],
      padding: `2px ${space[2]}px`,
      borderRadius: radii.pill,
      background: cfg.bg,
      border: `1px solid ${cfg.color}20`,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.05em",
      color: cfg.color,
      textTransform: "uppercase",
    }}>
      <span>{cfg.emoji}</span>
      {!mobile && cfg.label}
    </span>
  );
};
