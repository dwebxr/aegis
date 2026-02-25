"use client";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { ContentCard } from "@/components/ui/ContentCard";
import { D2ABadge } from "@/components/ui/D2ABadge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { isD2AContent, extractD2ASenderPk } from "@/lib/d2a/activity";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { formatICP } from "@/lib/ic/icpLedger";
import { handleICSessionError } from "@/lib/utils/errors";
import { errMsg } from "@/lib/utils/errors";
import { Principal } from "@dfinity/principal";
import { colors, space, fonts, type as t, radii, transitions } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import type { AgentState } from "@/lib/agent/types";
import type { D2AMatchRecord } from "@/lib/ic/declarations";
import type { Identity } from "@dfinity/agent";

type SubTab = "exchanges" | "published" | "matches";

interface D2ATabProps {
  content: ContentItem[];
  agentState: AgentState | null;
  mobile?: boolean;
  identity?: Identity | null;
  principalText?: string;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  onTabChange?: (tab: string) => void;
}

const surfaceCard = (m?: boolean): React.CSSProperties => ({
  background: colors.bg.surface,
  border: `1px solid ${colors.border.default}`,
  borderRadius: radii.lg,
  padding: m ? space[4] : space[5],
});

function formatTimestamp(nsOrMs: bigint | number): string {
  const ms = typeof nsOrMs === "bigint" ? Number(nsOrMs) / 1_000_000 : nsOrMs;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function truncPrincipal(p: Principal): string {
  const t = p.toText();
  return t.length > 16 ? t.slice(0, 8) + "..." + t.slice(-5) : t;
}

export const D2ATab: React.FC<D2ATabProps> = ({
  content, agentState, mobile, identity, principalText,
  onValidate, onFlag, onTabChange,
}) => {
  const [subTab, setSubTab] = useState<SubTab>("exchanges");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Match records from IC canister
  const [matches, setMatches] = useState<D2AMatchRecord[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchLoaded, setMatchLoaded] = useState(false);
  const [matchHasMore, setMatchHasMore] = useState(true);
  const [matchOffset, setMatchOffset] = useState(0);
  const PAGE_SIZE = 10;

  // Derived content lists
  const d2aReceived = useMemo(
    () => content.filter(isD2AContent).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [content],
  );
  const published = useMemo(
    () => content.filter(c => c.validated && c.verdict === "quality").sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [content],
  );

  // Load matches from IC
  const loadMatches = useCallback(async (offset: number) => {
    if (!identity || !principalText) return;
    setMatchLoading(true);
    try {
      const backend = await createBackendActorAsync(identity);
      const principal = Principal.fromText(principalText);
      const page = await backend.getUserD2AMatches(principal, BigInt(offset), BigInt(PAGE_SIZE));
      setMatches(prev => offset === 0 ? page : [...prev, ...page]);
      setMatchHasMore(page.length >= PAGE_SIZE);
      setMatchOffset(offset + page.length);
    } catch (err) {
      if (handleICSessionError(err)) return;
      console.warn("[d2a-tab] Failed to load matches:", errMsg(err));
    } finally {
      setMatchLoading(false);
      setMatchLoaded(true);
    }
  }, [identity, principalText]);

  // Trigger match load when switching to matches tab
  useEffect(() => {
    if (subTab === "matches" && !matchLoaded && identity && principalText) {
      loadMatches(0);
    }
  }, [subTab, matchLoaded, identity, principalText, loadMatches]);

  const counts = {
    exchanges: d2aReceived.length,
    published: published.length,
    matches: matches.length,
  };

  const subTabs: { id: SubTab; label: string; emoji: string }[] = [
    { id: "exchanges", label: "Exchanges", emoji: "\u21C4" },
    { id: "published", label: "Published", emoji: "\u2713" },
    { id: "matches", label: "Matches", emoji: "\u26A1" },
  ];

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      {/* Header */}
      <div style={{ marginBottom: mobile ? space[8] : space[12] }}>
        <h1 style={{
          fontSize: mobile ? t.display.mobileSz : t.display.size,
          fontWeight: t.display.weight,
          lineHeight: t.display.lineHeight,
          letterSpacing: t.display.letterSpacing,
          color: colors.text.primary,
          margin: 0,
        }}>
          D2A Activity
        </h1>
        <p style={{ fontSize: mobile ? t.body.mobileSz : t.body.size, color: colors.text.muted, marginTop: space[2] }}>
          {agentState?.isActive
            ? `Agent active \u2014 ${agentState.peers.length} peers, ${agentState.sentItems}\u2191 ${agentState.receivedItems}\u2193`
            : "Enable D2A Agent in Settings to exchange content with peers"}
        </p>
      </div>

      {/* Sub-tab selector */}
      <div style={{
        display: "flex", gap: space[1], marginBottom: space[4],
        background: colors.bg.surface, borderRadius: radii.md,
        border: `1px solid ${colors.border.default}`, padding: space[1],
      }}>
        {subTabs.map(st => (
          <button
            key={st.id}
            onClick={() => setSubTab(st.id)}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: space[1],
              padding: `${space[2]}px ${space[3]}px`,
              borderRadius: radii.sm, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: t.bodySm.size, fontWeight: 600,
              background: subTab === st.id ? colors.bg.raised : "transparent",
              color: subTab === st.id ? colors.purple[400] : colors.text.muted,
              transition: transitions.fast,
            }}
          >
            <span>{st.emoji}</span>
            {st.label}
            {counts[st.id] > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "1px 6px",
                borderRadius: radii.pill,
                background: subTab === st.id ? "rgba(167,139,250,0.15)" : colors.bg.raised,
                color: subTab === st.id ? colors.purple[400] : colors.text.disabled,
              }}>
                {counts[st.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Exchanges section */}
      {subTab === "exchanges" && (
        <div>
          {d2aReceived.length > 0 ? (
            d2aReceived.map((item, i) => (
              <div key={item.id} style={{ animation: `slideUp .3s ease ${i * 0.06}s both` }}>
                <ContentCard
                  item={item}
                  expanded={expanded === item.id}
                  onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
                  onValidate={onValidate}
                  onFlag={onFlag}
                  mobile={mobile}
                />
              </div>
            ))
          ) : (
            <EmptyState
              emoji={"\u21C4"}
              title="No D2A exchanges yet"
              subtitle={agentState?.isActive
                ? "Your agent is discovering peers. Content exchanges will appear here."
                : "Enable D2A Agent in Settings to start exchanging content with peers."}
              action={!agentState?.isActive && onTabChange ? () => onTabChange("settings") : undefined}
              actionLabel="Go to Settings"
              mobile={mobile}
            />
          )}
        </div>
      )}

      {/* Published section */}
      {subTab === "published" && (
        <div>
          {published.length > 0 ? (
            published.map((item, i) => (
              <div key={item.id} style={{ animation: `slideUp .3s ease ${i * 0.06}s both` }}>
                <div style={{
                  ...surfaceCard(mobile),
                  marginBottom: space[2],
                  display: "flex",
                  gap: space[3],
                  alignItems: "flex-start",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[1], flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, color: colors.text.secondary, fontFamily: fonts.mono, fontSize: t.bodySm.size }}>{item.author}</span>
                      <span style={{ fontSize: t.caption.size, color: colors.text.muted, background: colors.bg.raised, padding: "2px 8px", borderRadius: radii.sm }}>{item.source}</span>
                      <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>{item.timestamp}</span>
                    </div>
                    <p style={{
                      color: colors.text.secondary, fontSize: mobile ? t.body.mobileSz : t.body.size,
                      lineHeight: t.body.lineHeight, margin: 0,
                      overflow: "hidden", textOverflow: "ellipsis",
                      display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                    }}>
                      {item.text}
                    </p>
                  </div>
                  {item.scores && (
                    <div style={{
                      textAlign: "center", flexShrink: 0,
                      padding: `${space[1]}px ${space[2]}px`,
                      background: colors.bg.raised, borderRadius: radii.sm,
                    }}>
                      <div style={{ fontSize: t.h3.size, fontWeight: 700, color: colors.green[400], fontFamily: fonts.mono }}>
                        {item.scores.composite.toFixed(1)}
                      </div>
                      <div style={{ fontSize: 9, color: colors.text.muted, textTransform: "uppercase" }}>Score</div>
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              emoji={"\u2713"}
              title="No published signals yet"
              subtitle="Validate quality content in the Burn tab to build your signal history."
              action={onTabChange ? () => onTabChange("incinerator") : undefined}
              actionLabel="Start Evaluating"
              mobile={mobile}
            />
          )}
        </div>
      )}

      {/* Matches section (IC canister records) */}
      {subTab === "matches" && (
        <div>
          {!identity || !principalText ? (
            <EmptyState
              emoji={"\uD83D\uDD12"}
              title="Login required"
              subtitle="Sign in with Internet Identity to view your D2A match records."
              mobile={mobile}
            />
          ) : matchLoading && matches.length === 0 ? (
            <div style={{ ...surfaceCard(mobile), textAlign: "center", padding: space[10] }}>
              <div style={{ fontSize: 32, marginBottom: space[3], animation: "pulse 2s infinite" }}>{"\u26A1"}</div>
              <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>Loading match records...</div>
            </div>
          ) : matches.length > 0 ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
                <span style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.purple[400] }}>
                  Fee-Paid Matches
                </span>
                <InfoTooltip text="On-chain records of D2A content exchanges with fee payments. 80% goes to the content provider, 20% to the protocol." mobile={mobile} />
              </div>
              {matches.map((m, i) => {
                const isSender = principalText && m.senderPrincipal.toText() === principalText;
                return (
                  <div key={m.id} style={{
                    ...surfaceCard(mobile),
                    marginBottom: space[2],
                    animation: `slideUp .3s ease ${i * 0.04}s both`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
                      <div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 8px",
                          borderRadius: radii.pill, textTransform: "uppercase",
                          background: isSender ? "rgba(52,211,153,0.12)" : "rgba(56,189,248,0.12)",
                          color: isSender ? colors.green[400] : colors.sky[400],
                        }}>
                          {isSender ? "Sent" : "Received"}
                        </span>
                        <span style={{ fontSize: t.caption.size, color: colors.text.muted, marginLeft: space[2] }}>
                          {isSender ? truncPrincipal(m.receiverPrincipal) : truncPrincipal(m.senderPrincipal)}
                        </span>
                      </div>
                      <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>
                        {formatTimestamp(m.createdAt)}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: space[4], marginTop: space[2], flexWrap: "wrap" }}>
                      <div>
                        <span style={{ fontSize: 10, color: colors.text.muted, textTransform: "uppercase" }}>Fee </span>
                        <span style={{ fontFamily: fonts.mono, fontWeight: 600, color: colors.amber[400], fontSize: t.bodySm.size }}>
                          {formatICP(m.feeAmount)} ICP
                        </span>
                      </div>
                      {isSender && (
                        <div>
                          <span style={{ fontSize: 10, color: colors.text.muted, textTransform: "uppercase" }}>Earned </span>
                          <span style={{ fontFamily: fonts.mono, fontWeight: 600, color: colors.green[400], fontSize: t.bodySm.size }}>
                            {formatICP(m.senderPayout)} ICP
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {matchHasMore && (
                <button
                  onClick={() => loadMatches(matchOffset)}
                  disabled={matchLoading}
                  style={{
                    width: "100%", padding: `${space[3]}px`, marginTop: space[2],
                    background: colors.bg.surface, border: `1px solid ${colors.border.default}`,
                    borderRadius: radii.md, color: colors.purple[400],
                    fontSize: t.bodySm.size, fontWeight: 600, cursor: "pointer",
                    fontFamily: "inherit", transition: transitions.fast,
                    opacity: matchLoading ? 0.5 : 1,
                  }}
                >
                  {matchLoading ? "Loading..." : "Load More"}
                </button>
              )}
            </div>
          ) : matchLoaded ? (
            <EmptyState
              emoji={"\u26A1"}
              title="No match records yet"
              subtitle="Fee-paid matches from D2A content exchanges will appear here."
              mobile={mobile}
            />
          ) : null}
        </div>
      )}
    </div>
  );
};

// Shared empty state component
function EmptyState({ emoji, title, subtitle, action, actionLabel, mobile }: {
  emoji: string; title: string; subtitle: string;
  action?: () => void; actionLabel?: string; mobile?: boolean;
}) {
  return (
    <div style={{
      textAlign: "center", padding: space[10],
      color: colors.text.muted, background: colors.bg.surface,
      borderRadius: radii.lg, border: `1px solid ${colors.border.default}`,
    }}>
      <div style={{ fontSize: 32, marginBottom: space[3] }}>{emoji}</div>
      <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>{title}</div>
      <div style={{ fontSize: t.bodySm.size, marginTop: space[2] }}>{subtitle}</div>
      {action && actionLabel && (
        <div style={{ marginTop: space[4] }}>
          <button onClick={action} style={{
            padding: `${space[2]}px ${space[4]}px`, background: colors.bg.raised,
            border: `1px solid ${colors.border.emphasis}`, borderRadius: radii.md,
            color: colors.purple[400], fontSize: t.bodySm.size, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", transition: transitions.fast,
          }}>
            {actionLabel} &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
