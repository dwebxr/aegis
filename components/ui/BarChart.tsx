"use client";
import React from "react";

interface BarChartProps {
  data: number[];
  labels: string[];
  color: string;
  height?: number;
}

export const BarChart: React.FC<BarChartProps> = ({ data, labels, color, height = 64 }) => {
  const mx = Math.max(...data, 1);

  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((v, i) => (
        <div key={labels[i]} className="flex-1 flex flex-col items-center gap-[3px]">
          <div
            className="w-full rounded-t-[3px] transition-opacity duration-200"
            style={{
              height: `${(v / mx) * 52}px`,
              background: color,
              opacity: 0.5 + (v / mx) * 0.5,
              minHeight: 3,
            }}
          />
          <span className="text-tiny text-muted-foreground">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
};
