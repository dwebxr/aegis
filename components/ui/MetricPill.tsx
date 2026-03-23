"use client";
import React from "react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface MetricPillProps {
  icon: React.ReactNode;
  value: string | number;
  tooltip: string;
  color: string;
}

export const MetricPill: React.FC<MetricPillProps> = ({ icon, value, tooltip, color }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body-sm font-bold font-mono cursor-default"
        style={{
          background: `${color}10`,
          border: `1px solid ${color}18`,
          color,
        }}
        aria-label={tooltip}
      >
        <span className="flex items-center justify-center size-4 shrink-0 opacity-80">{icon}</span>
        <span>{value}</span>
      </div>
    </TooltipTrigger>
    <TooltipContent side="bottom" className="max-w-[240px]">
      {tooltip}
    </TooltipContent>
  </Tooltip>
);
