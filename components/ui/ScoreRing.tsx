"use client";
import React from "react";
import { fonts, colors } from "@/styles/theme";

interface ScoreRingProps {
  value: number;
  size?: number;
  color: string;
}

export const ScoreRing: React.FC<ScoreRingProps> = ({ value, size = 48, color }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: `conic-gradient(${color} ${value * 10}%, ${colors.bg.raised} ${value * 10}%)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <div style={{ width: size - 10, height: size - 10, borderRadius: "50%", background: colors.bg.surface, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size > 40 ? 14 : 12, fontWeight: 800, color, fontFamily: fonts.mono }}>
      {value.toFixed(1)}
    </div>
  </div>
);
