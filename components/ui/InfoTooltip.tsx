"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  text: string;
  mobile?: boolean;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ text, mobile }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("click", handleOutsideClick, true);
      return () => document.removeEventListener("click", handleOutsideClick, true);
    }
  }, [open, handleOutsideClick]);

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex items-center cursor-help", !mobile && "aegis-tooltip-wrap")}
      onClick={mobile ? () => setOpen(v => !v) : undefined}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v => !v); } }}
      role="button"
      aria-label="Info"
      tabIndex={0}
    >
      <span className="text-caption font-semibold text-[var(--color-text-disabled)] size-4 inline-flex items-center justify-center border border-[var(--color-border-emphasis)] rounded-full">
        i
      </span>
      <span
        className={cn(
          "absolute top-[calc(100%+6px)] bg-navy-lighter border border-[var(--color-border-emphasis)] rounded-sm px-3 py-2 text-caption text-[var(--color-text-tertiary)] leading-[1.5] whitespace-normal w-max z-[100] shadow-md transition-opacity duration-150",
          mobile ? "right-0 max-w-[calc(100vw-32px)]" : "left-0 max-w-[260px] pointer-events-none aegis-tooltip-content",
          mobile ? (open ? "opacity-100" : "opacity-0") : "opacity-0",
        )}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
};
