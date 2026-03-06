"use client";
import React from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  position?: "top" | "bottom";
}

export const Tooltip: React.FC<TooltipProps> = ({ text, children, position = "top" }) => (
  <span className="aegis-tooltip-wrap relative inline-flex items-center">
    {children}
    <span
      className={cn(
        "aegis-tooltip-content absolute left-1/2 -translate-x-1/2 bg-raised border border-emphasis rounded-sm px-2 py-1 text-caption text-tertiary leading-h2 whitespace-normal w-max max-w-[240px] z-[100] pointer-events-none opacity-0 transition-opacity duration-150 shadow-[0_4px_12px_rgba(0,0,0,0.4)]",
        position === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
      )}
    >
      {text}
    </span>
  </span>
);
