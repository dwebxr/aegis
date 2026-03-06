"use client";
import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
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
      <div className="bg-purple-600/[0.04] border border-purple-600/20 rounded-md px-4 py-3">
        <div className="text-caption font-bold text-purple-400 mb-2">
          D2A Agent — Before You Start
        </div>
        <div className="text-tiny text-secondary-foreground leading-relaxed mb-2">
          <div className="mb-1.5">
            <strong className="text-foreground">Automatic Content Exchange:</strong>{" "}
            Your agent will discover peers and automatically exchange content based on mutual interests via Nostr relays.
          </div>
          <div className="mb-1.5">
            <strong className="text-amber-400">Precision Match Fee:</strong>{" "}
            When you receive content, a trust-based fee is charged. New peers start at <strong className="font-mono">0.002 ICP</strong> (unknown). As you validate content and build your Web of Trust, fees decrease: <strong className="font-mono">0.001</strong> (known) or <strong className="font-mono">0.0005</strong> (trusted).
          </div>
          <div className="mb-1.5">
            <strong className="text-foreground">Fee Distribution:</strong>{" "}
            80% is distributed to the content provider as a content provision fee. 20% covers protocol operating costs.
          </div>
          <div className="mb-1.5">
            <strong className="text-foreground">Pre-Approval:</strong>{" "}
            Starting the agent will request an ICRC-2 approval of <strong className="font-mono">0.1 ICP</strong> to cover future match fees (approx. 100 matches).
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleCancel}
            className="px-3 py-1 bg-transparent border border-[var(--color-border-subtle)] rounded-sm text-muted-foreground text-tiny font-semibold cursor-pointer font-[inherit]"
          >
            Cancel
          </button>
          <button
            onClick={handleToggle}
            className="px-3 py-1 bg-purple-600/10 border border-purple-600/20 rounded-sm text-purple-400 text-tiny font-semibold cursor-pointer font-[inherit]"
          >
            I Understand — Start Agent
          </button>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn(
        "flex items-center gap-1.5 rounded-sm px-2 py-1 border",
        isEnabled
          ? "bg-purple-600/[0.06] border-purple-600/20"
          : "bg-[var(--color-border-subtle)] border-[var(--color-border-subtle)]"
      )}>
        <div className={cn(
          "size-1.5 rounded-full shrink-0",
          isEnabled ? "bg-purple-400 shadow-[0_0_6px_rgba(167,139,250,0.5)] animate-pulse" : "bg-[var(--color-text-disabled)]"
        )} />
        <span className={cn("text-tiny font-semibold", isEnabled ? "text-purple-400" : "text-muted-foreground")}>
          D2A
        </span>
        <button
          onClick={handleToggle}
          className={cn(
            "px-1.5 py-px rounded-sm text-tiny font-semibold cursor-pointer transition-fast font-[inherit] leading-tight border",
            isEnabled
              ? "bg-red-400/[0.06] border-red-400/15 text-red-400"
              : "bg-purple-600/10 border-purple-600/20 text-purple-400"
          )}
        >
          {isEnabled ? "Stop" : "Start"}
        </button>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-md px-4 py-3 border",
      isEnabled
        ? "bg-purple-600/[0.06] border-purple-600/20"
        : "bg-[var(--color-border-subtle)] border-[var(--color-border-subtle)]"
    )}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "size-[7px] rounded-full",
            isEnabled ? "bg-purple-400 shadow-[0_0_6px_rgba(167,139,250,0.5)] animate-pulse" : "bg-[var(--color-text-disabled)]"
          )} />
          <span className={cn("text-caption font-semibold", isEnabled ? "text-purple-400" : "text-muted-foreground")}>
            D2A Agent
          </span>
        </div>
        <button
          onClick={handleToggle}
          className={cn(
            "px-2 py-0.5 rounded-sm text-tiny font-semibold cursor-pointer transition-fast font-[inherit] border",
            isEnabled
              ? "bg-red-400/[0.06] border-red-400/15 text-red-400"
              : "bg-purple-600/10 border-purple-600/20 text-purple-400"
          )}
        >
          {isEnabled ? "Stop" : "Start"}
        </button>
      </div>
      {isEnabled && (
        <>
          <div className="flex gap-3 text-caption text-[var(--color-text-tertiary)]">
            <span><strong className="text-purple-400 font-mono">{peerCount}</strong> peers</span>
            <span><strong className="text-sky-400 font-mono">{activeHS}</strong> active</span>
            <span>
              <strong className="text-green-400 font-mono">{agentState.receivedItems}</strong>&#x2193;
              <strong className="text-amber-400 font-mono ml-0.5">{agentState.sentItems}</strong>&#x2191;
            </span>
          </div>
          {peerCount > 0 && (
            <div className="flex gap-2 text-tiny text-muted-foreground mt-1">
              {tierCounts.trusted > 0 && (
                <span className="text-green-400">{tierCounts.trusted} trusted</span>
              )}
              {tierCounts.known > 0 && (
                <span className="text-sky-400">{tierCounts.known} known</span>
              )}
              {tierCounts.unknown > 0 && (
                <span className="text-muted-foreground">{tierCounts.unknown} unknown</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
