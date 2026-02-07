"use client";
import React from "react";
import { useAuth } from "@/contexts/AuthContext";

interface UserBadgeProps {
  compact?: boolean;
}

export const UserBadge: React.FC<UserBadgeProps> = ({ compact }) => {
  const { isAuthenticated, principalText, isLoading, logout } = useAuth();

  if (isLoading || !isAuthenticated) return null;

  const short = principalText.length > 12
    ? principalText.slice(0, 5) + "..." + principalText.slice(-5)
    : principalText;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: compact ? "6px 10px" : "8px 14px",
        background: "rgba(52,211,153,0.06)",
        border: "1px solid rgba(52,211,153,0.15)",
        borderRadius: 10,
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#34d399",
          boxShadow: "0 0 6px rgba(52,211,153,0.5)",
        }} />
        <div style={{ overflow: "hidden", flex: 1 }}>
          <div style={{
            fontSize: compact ? 10 : 11,
            fontWeight: 600,
            color: "#e2e8f0",
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {short}
          </div>
          <div style={{ fontSize: 9, color: "#64748b", fontWeight: 500 }}>
            Connected
          </div>
        </div>
      </div>
      <button
        onClick={logout}
        style={{
          padding: compact ? "4px 10px" : "6px 14px",
          background: "rgba(248,113,113,0.08)",
          border: "1px solid rgba(248,113,113,0.15)",
          borderRadius: 8,
          color: "#f87171",
          fontSize: compact ? 10 : 11,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
          width: "100%",
        }}
      >
        Logout
      </button>
    </div>
  );
};
