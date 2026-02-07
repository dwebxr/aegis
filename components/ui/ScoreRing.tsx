"use client";
import React from "react";
import { fonts } from "@/styles/theme";

interface ScoreRingProps {
  value: number;
  size?: number;
  color: string;
}

export const ScoreRing: React.FC<ScoreRingProps> = ({ value, size = 48, color }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: `conic-gradient(${color} ${value * 10}%, #1e293b ${value * 10}%)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <div style={{ width: size - 10, height: size - 10, borderRadius: "50%", background: "#0f1729", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size > 40 ? 14 : 12, fontWeight: 800, color, fontFamily: fonts.mono }}>
      {value.toFixed(1)}
    </div>
  </div>
);
