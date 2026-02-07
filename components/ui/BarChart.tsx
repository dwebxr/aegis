"use client";
import React from "react";

interface BarChartProps {
  data: number[];
  labels: string[];
  color: string;
  height?: number;
}

export const BarChart: React.FC<BarChartProps> = ({ data, labels, color, height = 64 }) => {
  const mx = Math.max(...data);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ width: "100%", height: `${(v / mx) * 52}px`, background: color, borderRadius: "3px 3px 0 0", opacity: 0.5 + (v / mx) * 0.5, minHeight: 3 }} />
          <span style={{ fontSize: 8, color: "#64748b" }}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
};
