"use client";
import React from "react";

interface D2ABadgeProps {
  mobile?: boolean;
}

export const D2ABadge: React.FC<D2ABadgeProps> = ({ mobile }) => (
  <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-purple-400/10 border border-purple-400/[0.12] text-tiny font-bold tracking-[0.05em] text-purple-400 uppercase">
    <span>{"\u21C4"}</span>
    {!mobile && "D2A"}
  </span>
);
