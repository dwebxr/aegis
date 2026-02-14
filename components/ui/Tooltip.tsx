"use client";
import React from "react";
import { colors, radii, space, type as t } from "@/styles/theme";

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  position?: "top" | "bottom";
}

export const Tooltip: React.FC<TooltipProps> = ({ text, children, position = "top" }) => (
  <span className="aegis-tooltip-wrap" style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
    {children}
    <span
      className="aegis-tooltip-content"
      style={{
        position: "absolute",
        [position === "top" ? "bottom" : "top"]: "calc(100% + 6px)",
        left: "50%",
        transform: "translateX(-50%)",
        background: colors.bg.raised,
        border: `1px solid ${colors.border.emphasis}`,
        borderRadius: radii.sm,
        padding: `${space[1]}px ${space[2]}px`,
        fontSize: t.caption.size,
        color: colors.text.tertiary,
        lineHeight: 1.4,
        whiteSpace: "normal",
        width: "max-content",
        maxWidth: 240,
        zIndex: 100,
        pointerEvents: "none",
        opacity: 0,
        transition: "opacity 0.15s",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      {text}
    </span>
  </span>
);
