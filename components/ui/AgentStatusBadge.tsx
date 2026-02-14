"use client";
import React, { useState, useMemo } from "react";
import { fonts, colors, space, type as t, radii, transitions } from "@/styles/theme";
import { useAgent } from "@/contexts/AgentContext";
import { useAuth } from "@/contexts/AuthContext";
import { getReputation, calculateEffectiveTrust, getTrustTier, type TrustTier } from "@/lib/d2a/reputation";
import { calculateWoTScore } from "@/lib/wot/scorer";

interface AgentStatusBadgeProps {
  compact?: boolean;
}

export const AgentStatusBadge: React.FC<AgentStatusBadgeProps> = ({ compact }) => {
  const { isAuthenticated } = useAuth();
  const { agentState, isEnabled, toggleAgent, wotGraph } = useAgent();
  const [showConfirm, setShowConfirm] = useState(false);

  // Must be before early returns (React hooks rules)
  const tierCounts = useMemo(() => {
    const counts: Record<TrustTier, number> = { trusted: 0, known: 0, unknown: 0, restricted: 0 };
    for (const peer of agentState.peers) {
      const wotScore = wotGraph
        ? calculateWoTScore(peer.nostrPubkey, wotGraph).trustScore
        : 0;
      const rep = getReputation(peer.nostrPubkey);
      const repScore = rep?.score ?? 0;
      const trust = calculateEffectiveTrust(wotScore, repScore);
      counts[getTrustTier(trust)]++;
    }
    return counts;
  }, [agentState.peers, wotGraph]);

  if (!isAuthenticated) return null;

  const peerCount = agentState.peers.length;
  const activeHS = agentState.activeHandshakes.length;

  const handleToggle = () => {
    if (!isEnabled && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);
    toggleAgent();
  };

  const handleCancel = () => {
    setShowConfirm(false);
  };

  if (showConfirm && !isEnabled) {
    return (
      <div style={{
        background: `${colors.purple[600]}0A`,
        border: `1px solid ${colors.purple[600]}33`,
        borderRadius: radii.md,
        padding: `${space[3]}px ${space[4]}px`,
      }}>
        <div style={{ fontSize: t.caption.size, fontWeight: 700, color: colors.purple[400], marginBottom: space[2] }}>
          D2A Agent — Before You Start
        </div>
        <div style={{ fontSize: t.tiny.size, color: colors.text.secondary, lineHeight: 1.6, marginBottom: space[2] }}>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ color: colors.text.primary }}>Automatic Content Exchange:</strong>{" "}
            Your agent will discover peers and automatically exchange content based on mutual interests via Nostr relays.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ color: colors.amber[400] }}>Precision Match Fee:</strong>{" "}
            When you receive content, a trust-based fee is charged. New peers start at <strong style={{ fontFamily: fonts.mono }}>0.002 ICP</strong> (unknown). As you validate content and build your Web of Trust, fees decrease: <strong style={{ fontFamily: fonts.mono }}>0.001</strong> (known) or <strong style={{ fontFamily: fonts.mono }}>0.0005</strong> (trusted).
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ color: colors.text.primary }}>Fee Distribution:</strong>{" "}
            80% is distributed to the content provider as a content provision fee. 20% covers protocol operating costs.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ color: colors.text.primary }}>Pre-Approval:</strong>{" "}
            Starting the agent will request an ICRC-2 approval of <strong style={{ fontFamily: fonts.mono }}>0.1 ICP</strong> to cover future match fees (approx. 100 matches).
          </div>
        </div>
        <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
          <button
            onClick={handleCancel}
            style={{
              padding: `${space[1]}px ${space[3]}px`,
              background: "transparent",
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: radii.sm,
              color: colors.text.muted,
              fontSize: t.tiny.size, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleToggle}
            style={{
              padding: `${space[1]}px ${space[3]}px`,
              background: `${colors.purple[600]}1A`,
              border: `1px solid ${colors.purple[600]}33`,
              borderRadius: radii.sm,
              color: colors.purple[400],
              fontSize: t.tiny.size, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            I Understand — Start Agent
          </button>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        background: isEnabled ? `${colors.purple[600]}0F` : colors.border.subtle,
        border: `1px solid ${isEnabled ? `${colors.purple[600]}33` : colors.border.subtle}`,
        borderRadius: radii.sm,
        padding: `${space[1]}px ${space[2]}px`,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: isEnabled ? colors.purple[400] : colors.text.disabled,
          boxShadow: isEnabled ? `0 0 6px ${colors.purple[400]}80` : "none",
          animation: isEnabled ? "pulse 2s infinite" : "none",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: t.tiny.size, fontWeight: 600, color: isEnabled ? colors.purple[400] : colors.text.muted }}>
          D2A
        </span>
        <button
          onClick={handleToggle}
          style={{
            padding: `1px 6px`,
            background: isEnabled ? colors.red.bg : `${colors.purple[600]}1A`,
            border: `1px solid ${isEnabled ? colors.red.border : `${colors.purple[600]}33`}`,
            borderRadius: radii.sm,
            color: isEnabled ? colors.red[400] : colors.purple[400],
            fontSize: t.tiny.size, fontWeight: 600, cursor: "pointer",
            transition: transitions.fast, fontFamily: "inherit",
            lineHeight: 1.2,
          }}
        >
          {isEnabled ? "Stop" : "Start"}
        </button>
      </div>
    );
  }

  return (
    <div style={{
      background: isEnabled
        ? `${colors.purple[600]}0F`
        : colors.border.subtle,
      border: `1px solid ${isEnabled ? `${colors.purple[600]}33` : colors.border.subtle}`,
      borderRadius: radii.md,
      padding: `${space[3]}px ${space[4]}px`,
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
          onClick={handleToggle}
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
        <>
          <div style={{ display: "flex", gap: space[3], fontSize: t.caption.size, color: colors.text.tertiary }}>
            <span><strong style={{ color: colors.purple[400], fontFamily: fonts.mono }}>{peerCount}</strong> peers</span>
            <span><strong style={{ color: colors.sky[400], fontFamily: fonts.mono }}>{activeHS}</strong> active</span>
            <span>
              <strong style={{ color: colors.green[400], fontFamily: fonts.mono }}>{agentState.receivedItems}</strong>&#x2193;
              <strong style={{ color: colors.amber[400], fontFamily: fonts.mono, marginLeft: 2 }}>{agentState.sentItems}</strong>&#x2191;
            </span>
          </div>
          {peerCount > 0 && (
            <div style={{ display: "flex", gap: space[2], fontSize: t.tiny.size, color: colors.text.muted, marginTop: space[1] }}>
              {tierCounts.trusted > 0 && (
                <span style={{ color: colors.green[400] }}>{tierCounts.trusted} trusted</span>
              )}
              {tierCounts.known > 0 && (
                <span style={{ color: colors.sky[400] }}>{tierCounts.known} known</span>
              )}
              {tierCounts.unknown > 0 && (
                <span style={{ color: colors.text.muted }}>{tierCounts.unknown} unknown</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
