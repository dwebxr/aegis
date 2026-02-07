"use client";
import React from "react";
import { fonts, colors, space, type as t, radii, transitions } from "@/styles/theme";
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
        ? `${colors.purple[600]}0F`
        : colors.border.subtle,
      border: `1px solid ${isEnabled ? `${colors.purple[600]}33` : colors.border.subtle}`,
      borderRadius: radii.md,
      padding: compact ? `${space[2]}px ${space[3]}px` : `${space[3]}px ${space[4]}px`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space[1] }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: isEnabled ? colors.purple[400] : colors.text.disabled,
            boxShadow: isEnabled ? `0 0 6px ${colors.purple[400]}80` : "none",
            animation: isEnabled ? "pulse 2s infinite" : "none",
          }} />
          <span style={{ fontSize: t.caption.size, fontWeight: 600, color: isEnabled ? colors.purple[400] : colors.text.muted }}>
            D2A Agent
          </span>
        </div>
        <button
          onClick={toggleAgent}
          style={{
            padding: `2px ${space[2]}px`,
            background: isEnabled ? colors.red.bg : `${colors.purple[600]}1A`,
            border: `1px solid ${isEnabled ? colors.red.border : `${colors.purple[600]}33`}`,
            borderRadius: radii.sm,
            color: isEnabled ? colors.red[400] : colors.purple[400],
            fontSize: t.tiny.size, fontWeight: 600, cursor: "pointer",
            transition: transitions.fast, fontFamily: "inherit",
          }}
        >
          {isEnabled ? "Stop" : "Start"}
        </button>
      </div>
      {isEnabled && (
        <div style={{ display: "flex", gap: compact ? space[2] : space[3], fontSize: t.caption.size, color: colors.text.tertiary }}>
          <span><strong style={{ color: colors.purple[400], fontFamily: fonts.mono }}>{peerCount}</strong> peers</span>
          <span><strong style={{ color: colors.sky[400], fontFamily: fonts.mono }}>{activeHS}</strong> active</span>
          <span>
            <strong style={{ color: colors.green[400], fontFamily: fonts.mono }}>{agentState.receivedItems}</strong>&#x2193;
            <strong style={{ color: colors.amber[400], fontFamily: fonts.mono, marginLeft: 2 }}>{agentState.sentItems}</strong>&#x2191;
          </span>
        </div>
      )}
    </div>
  );
};
