"use client";
import React from "react";
import { colors, space, type as t, radii } from "@/styles/theme";

interface WoTPromptBannerProps {
  onGoToSettings: () => void;
  onDismiss: () => void;
}

export const WoTPromptBanner: React.FC<WoTPromptBannerProps> = ({ onGoToSettings, onDismiss }) => (
  <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space[2],
    padding: `${space[2]}px ${space[4]}px`,
    background: "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(6,182,212,0.08))",
    border: "1px solid rgba(34,197,94,0.2)",
    borderRadius: radii.md,
    marginBottom: space[4],
  }}>
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: space[2],
      flex: 1,
      minWidth: 0,
    }}>
      <span style={{ fontSize: t.bodySm.size, color: colors.text.tertiary, lineHeight: 1.4 }}>
        <strong style={{ color: colors.green[400] }}>Web of Trust</strong>
        {" \u2014 Link your Nostr account to activate trust-based content filtering"}
      </span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: space[2], flexShrink: 0 }}>
      <button
        onClick={onGoToSettings}
        style={{
          padding: `${space[1]}px ${space[3]}px`,
          background: `linear-gradient(135deg, ${colors.green[500]}, ${colors.cyan[500]})`,
          border: "none",
          borderRadius: radii.sm,
          color: "#fff",
          fontSize: t.bodySm.size,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Link Account
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: colors.text.disabled,
          fontSize: 14,
          padding: space[1],
          lineHeight: 1,
        }}
      >
        &#x2715;
      </button>
    </div>
  </div>
);
