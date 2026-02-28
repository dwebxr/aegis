"use client";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { ContentCard } from "@/components/ui/ContentCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AgentProfileEditModal } from "@/components/ui/AgentProfileEditModal";
import { PencilIcon } from "@/components/icons";
import { isD2AContent } from "@/lib/d2a/activity";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { formatICP } from "@/lib/ic/icpLedger";
import { handleICSessionError } from "@/lib/utils/errors";
import { errMsg } from "@/lib/utils/errors";
import { Principal } from "@dfinity/principal";
import { npubEncode } from "nostr-tools/nip19";
import { maskNpub } from "@/lib/nostr/linkAccount";
import { useAgent } from "@/contexts/AgentContext";
import { colors, space, fonts, type as t, radii, transitions } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import type { AgentState, ActivityLogEntry } from "@/lib/agent/types";
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

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

const LOG_ICONS: Record<string, { icon: string; color: string }> = {
  presence: { icon: "\uD83D\uDCE1", color: colors.text.muted },
  discovery: { icon: "\uD83D\uDD0D", color: colors.sky[400] },
  offer_sent: { icon: "\uD83E\uDD1D", color: colors.purple[400] },
  offer_received: { icon: "\uD83E\uDD1D", color: colors.purple[400] },
  accept: { icon: "\u2713", color: colors.green[400] },
  deliver: { icon: "\u2713", color: colors.green[400] },
  received: { icon: "\u2713", color: colors.green[400] },
  reject: { icon: "\u2717", color: colors.amber[400] },
  error: { icon: "\u26A0", color: colors.red[400] },
};

export const D2ATab: React.FC<D2ATabProps> = ({
  content, agentState, mobile, identity, principalText,
  onValidate, onFlag, onTabChange,
}) => {
  const { agentProfile, agentProfileLoading, nostrKeys, refreshAgentProfile } = useAgent();
  const [subTab, setSubTab] = useState<SubTab>("exchanges");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [npubCopyState, setNpubCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showProfileInfo, setShowProfileInfo] = useState(true);
  const [avatarError, setAvatarError] = useState(false);

  const currentPicture = agentProfile?.picture;
  useEffect(() => { setAvatarError(false); }, [currentPicture]);

  const [matches, setMatches] = useState<D2AMatchRecord[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchLoaded, setMatchLoaded] = useState(false);
  const [matchHasMore, setMatchHasMore] = useState(true);
  const [matchOffset, setMatchOffset] = useState(0);
  const [matchError, setMatchError] = useState<string | null>(null);
  const PAGE_SIZE = 10;

  const d2aReceived = useMemo(
    () => content.filter(isD2AContent).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [content],
  );
  const published = useMemo(
    () => content.filter(c => c.validated && c.verdict === "quality").sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [content],
  );

  const loadMatches = useCallback(async (offset: number) => {
    if (!identity || !principalText) return;
    setMatchLoading(true);
    setMatchError(null);
    try {
      const backend = await createBackendActorAsync(identity);
      const principal = Principal.fromText(principalText);
      const page = await backend.getUserD2AMatches(principal, BigInt(offset), BigInt(PAGE_SIZE));
      setMatches(prev => offset === 0 ? page : [...prev, ...page]);
      setMatchHasMore(page.length >= PAGE_SIZE);
      setMatchOffset(offset + page.length);
    } catch (err) {
      if (handleICSessionError(err)) return;
      setMatchError(errMsg(err));
      console.warn("[d2a-tab] Failed to load matches:", errMsg(err));
    } finally {
      setMatchLoading(false);
      setMatchLoaded(true);
    }
  }, [identity, principalText]);

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

      {/* Agent Card */}
      {agentState?.isActive && agentState.myPubkey && (() => {
        const avatarSize = mobile ? 36 : 44;
        const profilePicture = agentProfile?.picture;
        const profileName = agentProfile?.display_name || agentProfile?.name || (principalText ? `Aegis Agent for ${principalText.slice(0, 5)}...${principalText.slice(-3)}` : "Aegis Agent");
        return (
          <>
            <div style={{
              ...surfaceCard(mobile),
              marginBottom: space[4],
              display: "flex",
              gap: space[3],
              flexWrap: "wrap",
              alignItems: "flex-start",
            }}>
              {/* Avatar */}
              <div style={{
                width: avatarSize, height: avatarSize,
                borderRadius: "50%",
                border: `2px solid ${colors.green[400]}`,
                overflow: "hidden",
                flexShrink: 0,
                background: colors.bg.surface,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {profilePicture && !avatarError ? (
                  <img
                    src={profilePicture}
                    alt="Agent"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={() => setAvatarError(true)}
                  />
                ) : (
                  <span style={{ fontSize: avatarSize * 0.5, opacity: 0.4 }}>{"\uD83E\uDD16"}</span>
                )}
              </div>

              {/* Center: name + npub + about + website */}
              <div style={{ flex: 1, minWidth: 120 }}>
                {/* Name row */}
                <div style={{
                  fontSize: mobile ? t.h3.mobileSz : t.h3.size,
                  fontWeight: 700,
                  color: colors.text.primary,
                  marginBottom: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: space[2],
                }}>
                  {profileName}
                  {agentProfileLoading && (
                    <span style={{ fontSize: t.caption.size, color: colors.text.disabled, fontWeight: 400 }}>...</span>
                  )}
                </div>

                {/* npub + copy */}
                <div style={{ display: "flex", alignItems: "center", gap: space[2], position: "relative", marginBottom: space[1] }}>
                  <code style={{
                    fontFamily: fonts.mono, fontSize: t.caption.size,
                    color: colors.purple[400], letterSpacing: "0.02em",
                  }}>
                    {(() => { try { return maskNpub(npubEncode(agentState.myPubkey!)); } catch { return agentState.myPubkey?.slice(0, 12) + "\u2026"; } })()}
                  </code>
                  <button
                    onClick={() => {
                      try {
                        const fullNpub = npubEncode(agentState.myPubkey!);
                        navigator.clipboard.writeText(fullNpub).then(() => {
                          setNpubCopyState("copied");
                          setTimeout(() => setNpubCopyState("idle"), 2000);
                        }).catch(() => {
                          setNpubCopyState("failed");
                          setTimeout(() => setNpubCopyState("idle"), 2000);
                        });
                      } catch {
                        setNpubCopyState("failed");
                        setTimeout(() => setNpubCopyState("idle"), 2000);
                      }
                    }}
                    style={{
                      background: "none", border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.sm, padding: "1px 6px",
                      fontSize: 10, color: npubCopyState === "copied" ? colors.green[400] : npubCopyState === "failed" ? colors.red[400] : colors.text.muted,
                      cursor: "pointer", transition: transitions.fast,
                      fontFamily: fonts.sans, lineHeight: 1.4,
                    }}
                  >
                    {npubCopyState === "copied" ? "Copied!" : npubCopyState === "failed" ? "Failed" : "Copy npub"}
                  </button>
                  {npubCopyState === "copied" && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, marginTop: 4,
                      background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.sm, padding: "4px 8px",
                      fontFamily: fonts.mono, fontSize: 10, color: colors.purple[400],
                      whiteSpace: "nowrap", zIndex: 10,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                    }}>
                      {(() => { try { return npubEncode(agentState.myPubkey!); } catch { return ""; } })()}
                    </div>
                  )}
                </div>

                {/* About (optional) */}
                {agentProfile?.about && (
                  <p style={{
                    fontSize: t.bodySm.size, color: colors.text.tertiary,
                    lineHeight: 1.5, margin: 0, marginBottom: space[1],
                    overflow: "hidden", textOverflow: "ellipsis",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  }}>
                    {agentProfile.about}
                  </p>
                )}

                {/* Website (optional) */}
                {agentProfile?.website && (
                  <a
                    href={agentProfile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: t.caption.size, color: colors.cyan[400],
                      textDecoration: "none", display: "inline-flex",
                      alignItems: "center", gap: 4,
                    }}
                  >
                    {"\uD83D\uDD17"} {agentProfile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                )}
              </div>

              {/* Right: status + edit */}
              <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: space[2], alignItems: "flex-end" }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 8px",
                  borderRadius: radii.pill, textTransform: "uppercase",
                  background: "rgba(52,211,153,0.12)", color: colors.green[400],
                }}>
                  Active
                </span>
                <div style={{ fontSize: t.caption.size, color: colors.text.muted }}>
                  {agentState.peers.length} peers {"\u00B7"} {agentState.sentItems}{"\u2191"} {agentState.receivedItems}{"\u2193"}
                </div>
                {nostrKeys && principalText && (
                  <button
                    onClick={() => setShowProfileEdit(true)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      background: "none", border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.sm, padding: "2px 8px",
                      fontSize: t.caption.size, color: colors.text.muted,
                      cursor: "pointer", transition: transitions.fast,
                      fontFamily: fonts.sans,
                    }}
                  >
                    <PencilIcon s={10} /> Edit Profile
                  </button>
                )}
              </div>
            </div>

            {/* Explanatory text block */}
            {showProfileInfo && (
              <div style={{
                ...surfaceCard(mobile),
                marginBottom: space[4],
                borderLeft: `3px solid ${colors.purple[400]}`,
                padding: mobile ? space[3] : space[4],
              }}>
                <div style={{ fontSize: t.bodySm.size, color: colors.text.muted, lineHeight: 1.7 }}>
                  <p style={{ margin: 0, marginBottom: space[2] }}>
                    This account was auto-generated from your Internet Identity as your Aegis agent{"'"}s Nostr account.
                  </p>
                  <p style={{ margin: 0, marginBottom: space[2] }}>
                    Your linked main Nostr account (npub) is used only for the follow graph (WoT). All posts come from this agent account.
                  </p>
                  <p style={{ margin: 0 }}>
                    The icon, name, and about set here are published as a Nostr Kind 0 profile, visible from other Nostr clients.
                  </p>
                </div>
                <button
                  onClick={() => setShowProfileInfo(false)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: colors.purple[400], fontSize: t.caption.size,
                    fontWeight: 600, fontFamily: "inherit",
                    marginTop: space[2], padding: 0,
                  }}
                >
                  Hide
                </button>
              </div>
            )}
            {!showProfileInfo && (
              <button
                onClick={() => setShowProfileInfo(true)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: colors.text.disabled, fontSize: t.caption.size,
                  fontFamily: "inherit", marginBottom: space[4], padding: 0,
                }}
              >
                Learn more about this agent account
              </button>
            )}

          </>
        );
      })()}

      {/* Profile edit modal — outside agent-active guard so it survives deactivation */}
      {showProfileEdit && nostrKeys && principalText && (
        <AgentProfileEditModal
          currentProfile={agentProfile}
          nostrKeys={nostrKeys}
          principalText={principalText}
          onClose={() => setShowProfileEdit(false)}
          onSaved={() => {
            setShowProfileEdit(false);
            refreshAgentProfile();
          }}
          mobile={mobile}
        />
      )}

      {/* Activity Log */}
      {agentState?.isActive && agentState.activityLog.length > 0 && (
        <div style={{
          ...surfaceCard(mobile),
          marginBottom: space[4],
          padding: mobile ? space[3] : space[4],
        }}>
          <div style={{
            fontSize: t.caption.size, fontWeight: 600, color: colors.text.muted,
            textTransform: "uppercase", letterSpacing: "0.05em",
            marginBottom: space[2],
          }}>
            Activity Log
          </div>
          {(showAllLogs ? agentState.activityLog.slice(0, 20) : agentState.activityLog.slice(0, 5)).map((entry: ActivityLogEntry) => {
            const meta = LOG_ICONS[entry.type] || { icon: "\u2022", color: colors.text.muted };
            return (
              <div key={entry.id} style={{
                display: "flex", alignItems: "center", gap: space[2],
                padding: `${space[1]}px 0`,
                fontSize: t.caption.size,
                borderBottom: `1px solid ${colors.border.default}`,
              }}>
                <span style={{ color: meta.color, flexShrink: 0, width: 18, textAlign: "center" }}>{meta.icon}</span>
                <span style={{ color: colors.text.secondary, flex: 1 }}>
                  {entry.message}
                  {entry.peerId && (
                    <span style={{ color: colors.text.disabled, fontFamily: fonts.mono, marginLeft: space[1] }}>
                      {entry.peerId.slice(0, 8)}...
                    </span>
                  )}
                </span>
                <span style={{ color: colors.text.disabled, flexShrink: 0, fontSize: 10 }}>
                  {relativeTime(entry.timestamp)}
                </span>
              </div>
            );
          })}
          {agentState.activityLog.length > 5 && (
            <button
              onClick={() => setShowAllLogs(!showAllLogs)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: colors.purple[400], fontSize: t.caption.size,
                fontWeight: 600, fontFamily: "inherit",
                marginTop: space[2], padding: 0,
              }}
            >
              {showAllLogs ? "Show less" : `Show more (${agentState.activityLog.length})`}
            </button>
          )}
        </div>
      )}

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
          ) : agentState?.isActive ? (
            <EmptyState
              emoji={"\u21C4"}
              title="Waiting for exchanges"
              subtitle="Your agent is actively searching for compatible peers."
              checklist={[
                { done: true, text: "Agent identity established" },
                { done: true, text: "Broadcasting presence to relays" },
                { done: (agentState.peers.length ?? 0) > 0, text: `Discovering compatible peers (${agentState.peers.length} found)` },
                { done: agentState.activeHandshakes.length > 0 || agentState.sentItems > 0, text: "Negotiating content exchange" },
              ]}
            />
          ) : (
            <EmptyState
              emoji={"\u21C4"}
              title="Start exchanging content"
              subtitle="D2A lets your agent autonomously discover peers with shared interests and exchange quality content."
              action={onTabChange ? () => onTabChange("settings") : undefined}
              actionLabel="Enable in Settings"
            />
          )}
        </div>
      )}

      {/* Published section */}
      {subTab === "published" && (
        <div>
          <p style={{ fontSize: t.bodySm.size, color: colors.text.muted, marginTop: 0, marginBottom: space[4] }}>
            Content you{"'"}ve validated as quality. These signals demonstrate your curation taste and are shared with D2A peers during exchanges.
          </p>
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
                      <span style={{ fontSize: t.caption.size, color: colors.text.muted, background: colors.bg.raised, padding: "2px 8px", borderRadius: radii.sm }}>{item.platform || item.source}</span>
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
              subtitle="Validated content becomes your signal history \u2014 quality items you've verified are shared with D2A peers as proof of your curation taste."
              action={onTabChange ? () => onTabChange("incinerator") : undefined}
              actionLabel="Start Evaluating"
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
            />
          ) : matchError && matches.length === 0 ? (
            <EmptyState
              emoji={"\u26A0"}
              title="Failed to load matches"
              subtitle={matchError}
              action={() => { setMatchError(null); setMatchLoaded(false); }}
              actionLabel="Retry"
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
              subtitle="Fee-paid matches are recorded on the Internet Computer when exchanging with untrusted peers. Trusted peers (via WoT) exchange freely."
            />
          ) : null}
        </div>
      )}
    </div>
  );
};

function EmptyState({ emoji, title, subtitle, action, actionLabel, checklist }: {
  emoji: string; title: string; subtitle: string;
  action?: () => void; actionLabel?: string;
  checklist?: Array<{ done: boolean; text: string }>;
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
      {checklist && (
        <div style={{ textAlign: "left", display: "inline-block", marginTop: space[3] }}>
          {checklist.map((item, i) => (
            <div key={i} style={{
              display: "flex", gap: space[2], alignItems: "center",
              fontSize: t.bodySm.size, padding: `${space[1]}px 0`,
              color: item.done ? colors.green[400] : colors.text.disabled,
            }}>
              <span style={{ flexShrink: 0 }}>{item.done ? "\u2713" : "\u25CC"}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      )}
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
