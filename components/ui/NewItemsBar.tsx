"use client";
import React from "react";
import { colors, space, radii, type as t, transitions, fonts } from "@/styles/theme";

interface NewItemsBarProps {
  count: number;
  onFlush: () => void;
}

export const NewItemsBar: React.FC<NewItemsBarProps> = ({ count, onFlush }) => {
  if (count === 0) return null;

  return (
    <button
      data-testid="new-items-bar"
      onClick={onFlush}
      style={{
        display: "block",
        width: "100%",
        padding: `${space[2]}px ${space[3]}px`,
        marginBottom: space[2],
        background: `${colors.amber[400]}12`,
        border: `1px solid ${colors.amber[400]}33`,
        borderRadius: radii.md,
        color: colors.amber[400],
        fontSize: t.bodySm.size,
        fontWeight: 600,
        fontFamily: fonts.sans,
        cursor: "pointer",
        textAlign: "center",
        transition: transitions.fast,
        animation: "slideDown .3s ease both",
      }}
    >
      {count} new article{count !== 1 ? "s" : ""} — tap to show
    </button>
  );
};
