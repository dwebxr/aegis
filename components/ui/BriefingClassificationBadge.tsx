"use client";
import React from "react";
import type { BriefingClassification } from "@/lib/briefing/types";

const BADGE_CONFIG: Record<Exclude<BriefingClassification, "mixed">, { label: string; cls: string }> = {
  familiar: {
    label: "YOUR EXPERTISE",
    cls: "text-blue-400 bg-blue-500/[0.08] border-blue-500/20",
  },
  novel: {
    label: "NEW HORIZON",
    cls: "text-purple-400 bg-purple-500/[0.08] border-purple-500/20",
  },
};

export const BriefingClassificationBadge: React.FC<{ classification: BriefingClassification }> = ({ classification }) => {
  if (classification === "mixed") return null;
  const cfg = BADGE_CONFIG[classification];
  return (
    <span className={`text-tiny font-semibold tracking-wide leading-[1.4] whitespace-nowrap rounded-sm px-1.5 py-px border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};
