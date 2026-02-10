"use client";
import React from "react";
import { useDemo } from "@/contexts/DemoContext";
import { useAuth } from "@/contexts/AuthContext";
import { colors, space, type as t, radii } from "@/styles/theme";

export const DemoBanner: React.FC<{ mobile?: boolean }> = ({ mobile }) => {
  const { isDemoMode, bannerDismissed, dismissBanner } = useDemo();
  const { login } = useAuth();

  if (!isDemoMode || bannerDismissed) return null;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: space[2],
      padding: `${space[2]}px ${space[4]}px`,
      background: "linear-gradient(135deg, rgba(37,99,235,0.08), rgba(6,182,212,0.08))",
      border: "1px solid rgba(37,99,235,0.2)",
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
        <span style={{ fontSize: 14, flexShrink: 0 }}>&#x1F6E1;&#xFE0F;</span>
        <span style={{
          fontSize: mobile ? t.caption.size : t.bodySm.size,
          color: colors.text.tertiary,
          lineHeight: 1.4,
        }}>
          <strong style={{ color: colors.blue[400] }}>Demo Mode</strong>
          {" \u2014 "}
          {mobile
            ? "Preset feeds active. Login for full access."
            : "Exploring with preset feeds. Login to save sources & access all features."}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: space[2], flexShrink: 0 }}>
        <button
          onClick={login}
          style={{
            padding: `${space[1]}px ${space[3]}px`,
            background: `linear-gradient(135deg, ${colors.blue[600]}, ${colors.cyan[500]})`,
            border: "none",
            borderRadius: radii.sm,
            color: "#fff",
            fontSize: t.bodySm.size,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Login
        </button>
        <button
          onClick={dismissBanner}
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
};
