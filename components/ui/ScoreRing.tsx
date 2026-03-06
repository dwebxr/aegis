"use client";
import React from "react";
import { cn } from "@/lib/utils";

interface ScoreRingProps {
  value: number;
  size?: number;
  color: string;
}

export const ScoreRing: React.FC<ScoreRingProps> = ({ value, size = 48, color }) => (
  <div
    className="flex items-center justify-center rounded-full shrink-0"
    style={{
      width: size,
      height: size,
      background: `conic-gradient(${color} ${value * 10}%, var(--color-bg-raised) ${value * 10}%)`,
    }}
  >
    <div
      className={cn(
        "rounded-full bg-card flex items-center justify-center font-mono font-extrabold",
        size > 40 ? "text-sm" : "text-xs"
      )}
      style={{ width: size - 10, height: size - 10, color }}
    >
      {value.toFixed(1)}
    </div>
  </div>
);
