"use client";
import React from "react";
import { colors, space, radii } from "@/styles/theme";

interface D2ABadgeProps {
  mobile?: boolean;
}

export const D2ABadge: React.FC<D2ABadgeProps> = ({ mobile }) => (
  <span style={{
    display: "inline-flex",
    alignItems: "center",
    gap: space[1],
    padding: `2px ${space[2]}px`,
    borderRadius: radii.pill,
    background: "rgba(167,139,250,0.1)",
    border: `1px solid ${colors.purple[400]}20`,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: colors.purple[400],
    textTransform: "uppercase",
  }}>
    <span>{"\u21C4"}</span>
    {!mobile && "D2A"}
  </span>
);
