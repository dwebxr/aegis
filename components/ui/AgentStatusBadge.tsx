"use client";
import React from "react";
import { fonts } from "@/styles/theme";
import { useAgent } from "@/contexts/AgentContext";
import { useAuth } from "@/contexts/AuthContext";

interface AgentStatusBadgeProps {
  compact?: boolean;
}

export const AgentStatusBadge: React.FC<AgentStatusBadgeProps> = ({ compact }) => {
  const { isAuthenticated } = useAuth();
  const { agentState, isEnabled, toggleAgent } = useAgent();

  if (!isAuthenticated) return null;

  const peerCount = agentState.peers.length;
  const activeHS = agentState.activeHandshakes.length;

  return (
    <div style={{
      background: isEnabled
        ? "rgba(124,58,237,0.06)"
        : "rgba(255,255,255,0.02)",
      border: `1px solid ${isEnabled ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.06)"}`,
      borderRadius: 10,
      padding: compact ? "8px 10px" : "10px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: isEnabled ? "#a78bfa" : "#475569",
            boxShadow: isEnabled ? "0 0 6px rgba(167,139,250,0.5)" : "none",
            animation: isEnabled ? "pulse 2s infinite" : "none",
          }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: isEnabled ? "#a78bfa" : "#64748b" }}>
            D2A Agent
          </span>
        </div>
        <button
          onClick={toggleAgent}
          style={{
            padding: "2px 8px",
            background: isEnabled ? "rgba(248,113,113,0.1)" : "rgba(124,58,237,0.1)",
            border: `1px solid ${isEnabled ? "rgba(248,113,113,0.2)" : "rgba(124,58,237,0.2)"}`,
            borderRadius: 6,
            color: isEnabled ? "#f87171" : "#a78bfa",
            fontSize: 9,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isEnabled ? "Stop" : "Start"}
        </button>
      </div>
      {isEnabled && (
        <div style={{ display: "flex", gap: compact ? 8 : 12, fontSize: 10, color: "#94a3b8" }}>
          <span><strong style={{ color: "#a78bfa", fontFamily: fonts.mono }}>{peerCount}</strong> peers</span>
          <span><strong style={{ color: "#38bdf8", fontFamily: fonts.mono }}>{activeHS}</strong> active</span>
          <span>
            <strong style={{ color: "#34d399", fontFamily: fonts.mono }}>{agentState.receivedItems}</strong>&#x2193;
            <strong style={{ color: "#fbbf24", fontFamily: fonts.mono, marginLeft: 2 }}>{agentState.sentItems}</strong>&#x2191;
          </span>
        </div>
      )}
    </div>
  );
};
