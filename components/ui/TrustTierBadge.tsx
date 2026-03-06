import React from "react";
import { cn } from "@/lib/utils";
import type { TrustTier } from "@/lib/d2a/reputation";

const TIER_CLASSES: Record<TrustTier, string> = {
  trusted: "text-green-400 border-green-400/20 bg-green-400/[0.07]",
  known: "text-cyan-400 border-cyan-400/20 bg-cyan-400/[0.07]",
  unknown: "text-[var(--color-text-disabled)] border-[var(--color-text-disabled)]/20 bg-[var(--color-text-disabled)]/[0.07]",
  restricted: "text-red-400 border-red-400/20 bg-red-400/[0.07]",
};

const TIER_LABELS: Record<TrustTier, string> = {
  trusted: "Trusted",
  known: "Known",
  unknown: "Unknown",
  restricted: "Restricted",
};

export const TrustTierBadge: React.FC<{ tier: TrustTier }> = ({ tier }) => {
  return (
    <span className={cn(
      "inline-block px-2 py-px rounded-full border text-tiny font-semibold tracking-wide uppercase leading-[1.6]",
      TIER_CLASSES[tier]
    )}>
      {TIER_LABELS[tier]}
    </span>
  );
};
