"use client";
import React from "react";
import { useAuth } from "@/contexts/AuthContext";

interface LoginButtonProps {
  compact?: boolean;
}

export const LoginButton: React.FC<LoginButtonProps> = ({ compact }) => {
  const { isAuthenticated, isLoading, login, logout } = useAuth();

  if (isLoading) {
    return (
      <div style={{ padding: compact ? "6px 12px" : "10px 18px", fontSize: 12, color: "#64748b" }}>
        <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>&#x27F3;</span>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <button
        onClick={logout}
        style={{
          padding: compact ? "6px 12px" : "8px 16px",
          background: "rgba(248,113,113,0.1)",
          border: "1px solid rgba(248,113,113,0.2)",
          borderRadius: 8,
          color: "#f87171",
          fontSize: compact ? 11 : 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Logout
      </button>
    );
  }

  return (
    <button
      onClick={login}
      style={{
        padding: compact ? "6px 12px" : "10px 18px",
        background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
        border: "none",
        borderRadius: 10,
        color: "#fff",
        fontSize: compact ? 11 : 13,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{ fontSize: compact ? 13 : 16 }}>🔐</span>
      {compact ? "Login" : "Login with Internet Identity"}
    </button>
  );
};
