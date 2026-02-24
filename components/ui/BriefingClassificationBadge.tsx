"use client";
import React from "react";
import { colors, radii, type as t } from "@/styles/theme";
import type { BriefingClassification } from "@/lib/briefing/types";

interface BriefingClassificationBadgeProps {
  classification: BriefingClassification;
}

const BADGE_CONFIG: Record<Exclude<BriefingClassification, "mixed">, { label: string; color: string; bg: string; border: string }> = {
  familiar: {
    label: "YOUR EXPERTISE",
    color: colors.blue[400],
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.2)",
  },
  novel: {
    label: "NEW HORIZON",
    color: colors.purple[400],
    bg: "rgba(139,92,246,0.08)",
    border: "rgba(139,92,246,0.2)",
  },
};

export const BriefingClassificationBadge: React.FC<BriefingClassificationBadgeProps> = ({ classification }) => {
  if (classification === "mixed") return null;
  const cfg = BADGE_CONFIG[classification];
  return (
    <span style={{
      fontSize: t.tiny.size,
      fontWeight: t.tiny.weight,
      letterSpacing: t.tiny.letterSpacing,
      color: cfg.color,
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: radii.sm,
      padding: "1px 6px",
      lineHeight: 1.4,
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
};
