"use client";
import React from "react";
import { colors, type as t } from "@/styles/theme";

interface BarChartProps {
  data: number[];
  labels: string[];
  color: string;
  height?: number;
}

export const BarChart: React.FC<BarChartProps> = ({ data, labels, color, height = 64 }) => {
  const mx = Math.max(...data, 1);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{
            width: "100%", height: `${(v / mx) * 52}px`,
            background: color, borderRadius: "3px 3px 0 0",
            opacity: 0.5 + (v / mx) * 0.5, minHeight: 3,
            transition: "opacity 0.2s ease",
          }} />
          <span style={{ fontSize: t.tiny.size, color: colors.text.muted }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
};
