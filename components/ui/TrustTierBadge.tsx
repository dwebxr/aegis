import React from "react";
import type { TrustTier } from "@/lib/d2a/reputation";
import { colors, radii, type as t } from "@/styles/theme";

const TIER_COLORS: Record<TrustTier, string> = {
  trusted: colors.green[400],
  known: colors.cyan[400],
  unknown: colors.text.disabled,
  restricted: colors.red[400],
};

const TIER_LABELS: Record<TrustTier, string> = {
  trusted: "Trusted",
  known: "Known",
  unknown: "Unknown",
  restricted: "Restricted",
};

export const TrustTierBadge: React.FC<{ tier: TrustTier }> = ({ tier }) => {
  const color = TIER_COLORS[tier];
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 8px",
      borderRadius: radii.pill,
      border: `1px solid ${color}33`,
      background: `${color}12`,
      color,
      fontSize: t.tiny.size,
      fontWeight: t.tiny.weight,
      letterSpacing: t.tiny.letterSpacing,
      textTransform: "uppercase",
      lineHeight: 1.6,
    }}>
      {TIER_LABELS[tier]}
    </span>
  );
};
