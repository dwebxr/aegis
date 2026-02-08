"use client";
import React, { useState } from "react";
import { fonts, colors, space, type as t, shadows, radii, transitions, kpiLabelStyle } from "@/styles/theme";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  mobile?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({ icon, label, value, sub, color, mobile }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: radii.lg,
        padding: mobile ? `${space[4]}px ${space[4]}px` : `${space[5]}px ${space[6]}px`,
        position: "relative",
        overflow: "hidden",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? shadows.md : "none",
        transition: transitions.normal,
      }}
    >
      <div style={{
        position: "absolute", top: -20, right: -20,
        width: 80, height: 80, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}12, transparent 70%)`,
      }} />

      <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
        <div style={{
          width: 28, height: 28, borderRadius: radii.sm,
          background: `${color}15`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color,
        }}>
          {icon}
        </div>
        <span style={kpiLabelStyle}>{label}</span>
      </div>

      <div style={{
        fontSize: mobile ? t.kpiValue.mobileSz : t.kpiValue.size,
        fontWeight: t.kpiValue.weight,
        lineHeight: t.kpiValue.lineHeight,
        color: colors.text.primary,
        fontFamily: fonts.mono,
      }}>
        {value}
      </div>

      {sub && (
        <div style={{ fontSize: t.caption.size, fontWeight: t.kpiSub.weight, color: colors.text.disabled, marginTop: space[1] }}>
          {sub}
        </div>
      )}
    </div>
  );
};
