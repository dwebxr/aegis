"use client";
import React, { useMemo } from "react";
import { colors, space, type as t, radii, fonts } from "@/styles/theme";
import { useAgent } from "@/contexts/AgentContext";
import { getReputation, calculateEffectiveTrust, getTrustTier, type TrustTier } from "@/lib/d2a/reputation";
import { calculateWoTScore } from "@/lib/wot/scorer";

interface D2ANetworkMiniProps {
  mobile?: boolean;
}

const TIER_COLORS: Record<TrustTier, string> = {
  trusted: colors.cyan[400],
  known: colors.green[400],
  unknown: colors.amber[400],
  restricted: colors.red[400],
};

const MAX_PEERS = 8;
const W = 240;
const H = 80;
const CX = W / 2;
const CY = H / 2;
const RX = 90;
const RY = 28;

export const D2ANetworkMini: React.FC<D2ANetworkMiniProps> = ({ mobile }) => {
  const { agentState, wotGraph } = useAgent();

  const peerNodes = useMemo(() => {
    if (!agentState.isActive || agentState.peers.length === 0) return [];
    const sorted = [...agentState.peers].sort((a, b) => (b.resonance ?? 0) - (a.resonance ?? 0));
    const visible = sorted.slice(0, MAX_PEERS);
    const handshakePeers = new Set(agentState.activeHandshakes.map(h => h.peerId));
    const step = (Math.PI * 2) / Math.max(visible.length, 1);

    return visible.map((peer, i) => {
      const angle = -Math.PI / 2 + i * step;
      const wotScore = wotGraph ? calculateWoTScore(peer.nostrPubkey, wotGraph).trustScore : 0;
      const rep = getReputation(peer.nostrPubkey);
      const trust = calculateEffectiveTrust(wotScore, rep?.score ?? 0);
      const tier = getTrustTier(trust);
      return {
        x: CX + RX * Math.cos(angle),
        y: CY + RY * Math.sin(angle),
        color: TIER_COLORS[tier],
        tier,
        handshaking: handshakePeers.has(peer.nostrPubkey),
        pubkey: peer.nostrPubkey,
      };
    });
  }, [agentState.isActive, agentState.peers, agentState.activeHandshakes, wotGraph]);

  if (!agentState.isActive || agentState.peers.length === 0) return null;

  const overflow = agentState.peers.length - MAX_PEERS;

  return (
    <div style={{
      marginTop: space[3],
      padding: `${space[3]}px ${space[4]}px`,
      background: colors.bg.surface,
      border: `1px solid ${colors.border.default}`,
      borderRadius: radii.md,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: space[2],
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: colors.purple[400],
            boxShadow: `0 0 6px ${colors.purple[400]}80`,
            animation: "pulse 2s infinite",
          }} />
          <span style={{ fontSize: t.bodySm.size, fontWeight: 600, color: colors.text.tertiary }}>
            D2A Network
          </span>
        </div>
        <div style={{ display: "flex", gap: space[3], fontSize: t.caption.size, color: colors.text.muted }}>
          <span>
            <strong style={{ color: colors.purple[400], fontFamily: fonts.mono }}>{agentState.peers.length}</strong> peers
          </span>
          <span>
            <strong style={{ color: colors.green[400], fontFamily: fonts.mono }}>{agentState.receivedItems}</strong>&#x2193;
            {" "}
            <strong style={{ color: colors.amber[400], fontFamily: fonts.mono }}>{agentState.sentItems}</strong>&#x2191;
          </span>
        </div>
      </div>

      {/* SVG Network Graph */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={mobile ? 60 : 80}
        style={{ display: "block" }}
      >
        {/* Orbit guide */}
        <ellipse
          cx={CX} cy={CY} rx={RX} ry={RY}
          fill="none" stroke={colors.border.subtle} strokeWidth={0.5}
          strokeDasharray="3 3"
        />

        {/* Connection lines */}
        {peerNodes.map(n => (
          <line
            key={`line-${n.pubkey}`}
            x1={CX} y1={CY} x2={n.x} y2={n.y}
            stroke={n.color}
            strokeWidth={n.handshaking ? 1.5 : 0.8}
            strokeOpacity={n.handshaking ? 0.9 : 0.4}
          />
        ))}

        {/* Active handshake overlay lines */}
        {peerNodes.filter(n => n.handshaking).map(n => (
          <line
            key={`hs-${n.pubkey}`}
            x1={CX} y1={CY} x2={n.x} y2={n.y}
            stroke={n.color}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeOpacity={0.8}
            style={{ animation: "pulse 1.5s infinite" }}
          />
        ))}

        {/* Peer nodes */}
        {peerNodes.map(n => (
          <circle
            key={`node-${n.pubkey}`}
            cx={n.x} cy={n.y} r={4}
            fill={n.color}
            fillOpacity={n.handshaking ? 1 : 0.7}
          />
        ))}

        {/* User center node */}
        <circle cx={CX} cy={CY} r={6} fill={colors.purple[400]} />
        <circle cx={CX} cy={CY} r={3} fill={colors.purple[600]} />

        {/* Overflow indicator */}
        {overflow > 0 && (
          <text
            x={W - 8} y={H - 6}
            textAnchor="end"
            fill={colors.text.disabled}
            fontSize={8}
            fontFamily={fonts.mono}
          >
            +{overflow}
          </text>
        )}
      </svg>
    </div>
  );
};
