"use client";
import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { colors, space, radii, shadows, transitions } from "@/styles/theme";
import { ShieldIcon } from "@/components/icons";

interface LoginButtonProps {
  compact?: boolean;
}

export const LoginButton: React.FC<LoginButtonProps> = ({ compact }) => {
  const { isAuthenticated, isLoading, login, logout } = useAuth();
  const [hovered, setHovered] = useState(false);

  if (isLoading) {
    return (
      <div style={{ padding: compact ? `6px ${space[3]}px` : `${space[3]}px 18px`, fontSize: 12, color: colors.text.muted }}>
        <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>&#x27F3;</span>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <button
        onClick={logout}
        style={{
          padding: compact ? `6px ${space[3]}px` : `${space[2]}px ${space[4]}px`,
          background: colors.red.bg,
          border: `1px solid ${colors.red.border}`,
          borderRadius: radii.sm,
          color: colors.red[400],
          fontSize: compact ? 11 : 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: transitions.fast,
        }}
      >
        Logout
      </button>
    );
  }

  return (
    <button
      onClick={login}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: compact ? `6px ${space[3]}px` : `${space[3]}px 18px`,
        background: `linear-gradient(135deg, ${colors.blue[600]}, ${colors.cyan[500]})`,
        border: "none",
        borderRadius: radii.md,
        color: "#fff",
        fontSize: compact ? 11 : 13,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        gap: 6,
        boxShadow: hovered ? shadows.glow.cyan : "none",
        transform: hovered ? "scale(1.02)" : "scale(1)",
        transition: transitions.fast,
      }}
    >
      <ShieldIcon s={compact ? 13 : 16} />
      {compact ? "Login" : "Login with Internet Identity"}
    </button>
  );
};
