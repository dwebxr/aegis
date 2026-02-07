"use client";
import React from "react";

interface MiniChartProps {
  data: number[];
  color: string;
  h?: number;
}

export const MiniChart: React.FC<MiniChartProps> = ({ data, color, h = 48 }) => {
  const mx = Math.max(...data);
  const mn = Math.min(...data);
  const rg = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${h - ((v - mn) / rg) * (h - 8)}`).join(" ");

  return (
    <svg width="100%" height={h} viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,${h} ${pts} 100,${h}`} fill={`${color}18`} stroke="none" />
    </svg>
  );
};
