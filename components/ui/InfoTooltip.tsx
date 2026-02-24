"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { colors, radii, space, type as t } from "@/styles/theme";

interface InfoTooltipProps {
  text: string;
  mobile?: boolean;
}

/**
 * Info icon with tooltip. Desktop: hover. Mobile: tap to toggle, tap outside to close.
 */
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
      className={mobile ? undefined : "aegis-tooltip-wrap"}
      onClick={mobile ? () => setOpen(v => !v) : undefined}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v => !v); } }}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", cursor: "help" }}
      role="button"
      aria-label="Info"
      tabIndex={0}
    >
      <span style={{
        fontSize: t.caption.size,
        fontWeight: 600,
        color: colors.text.disabled,
        width: 16, height: 16,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${colors.border.emphasis}`,
        borderRadius: radii.pill,
      }}>i</span>
      <span
        className={mobile ? undefined : "aegis-tooltip-content"}
        style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          background: colors.bg.raised,
          border: `1px solid ${colors.border.emphasis}`,
          borderRadius: radii.sm,
          padding: `${space[2]}px ${space[3]}px`,
          fontSize: t.caption.size,
          color: colors.text.tertiary,
          lineHeight: 1.5,
          whiteSpace: "normal",
          width: "max-content",
          maxWidth: 260,
          zIndex: 100,
          pointerEvents: mobile ? "auto" : "none",
          opacity: mobile ? (open ? 1 : 0) : 0,
          transition: "opacity 0.15s",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
};
