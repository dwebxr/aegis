"use client";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ContentCard } from "@/components/ui/ContentCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AgentProfileEditModal } from "@/components/ui/AgentProfileEditModal";
import { PencilIcon } from "@/components/icons";
import { relativeTime } from "@/lib/utils/scores";
import { isD2AContent } from "@/lib/d2a/activity";
import { computePeerStats, sortPeerStats } from "@/lib/d2a/peerStats";
import type { PeerSortKey } from "@/lib/d2a/peerStats";
import { loadReputations } from "@/lib/d2a/reputation";
import { TrustTierBadge } from "@/components/ui/TrustTierBadge";
import { CommentInput } from "@/components/ui/CommentInput";
import { CommentThread } from "@/components/ui/CommentThread";
import { CreateGroupModal } from "@/components/ui/CreateGroupModal";
import { GroupCard } from "@/components/ui/GroupCard";
import { GroupFeedView } from "@/components/ui/GroupFeedView";
import { loadGroups, saveGroup, removeGroup, addMember, removeMember } from "@/lib/d2a/curationGroup";
import type { CurationGroup } from "@/lib/d2a/curationGroup";
import { buildGroupFeed } from "@/lib/d2a/curationFeed";
import { publishCurationList } from "@/lib/nostr/lists";
import { hashContent } from "@/lib/utils/hashing";
import type { D2ACommentPayload } from "@/lib/agent/types";
import { createBackendActorAsync } from "@/lib/ic/actor";
import { formatICP } from "@/lib/ic/icpLedger";
import { handleICSessionError, errMsg } from "@/lib/utils/errors";
import { Principal } from "@dfinity/principal";
import { npubEncode } from "nostr-tools/nip19";
import { maskNpub } from "@/lib/nostr/linkAccount";
import { useAgent } from "@/contexts/AgentContext";
import type { ContentItem } from "@/lib/types/content";
import type { AgentState, ActivityLogEntry } from "@/lib/agent/types";
import type { D2AMatchRecord } from "@/lib/ic/declarations";
import type { Identity } from "@dfinity/agent";

type SubTab = "exchanges" | "published" | "matches" | "peers" | "groups";

interface D2ATabProps {
  content: ContentItem[];
  agentState: AgentState | null;
  mobile?: boolean;
  identity?: Identity | null;
  principalText?: string;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  onTabChange?: (tab: string) => void;
  onTranslate?: (id: string) => void;
  isItemTranslating?: (id: string) => boolean;
}

const surfaceCardClass = (m?: boolean) => cn(
  "bg-card border border-border rounded-lg",
  m ? "p-4" : "p-5",
);

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

function formatNpub(pk: string | null | undefined, fallback: string): string {
  if (!pk) return fallback;
  try { return maskNpub(npubEncode(pk)); } catch { return fallback; }
}

function fullNpub(pk: string | null | undefined): string {
  if (!pk) return "";
  try { return npubEncode(pk); } catch { return ""; }
}

const LOG_ICONS: Record<string, { icon: string; colorClass: string }> = {
  presence: { icon: "\uD83D\uDCE1", colorClass: "text-muted-foreground" },
  discovery: { icon: "\uD83D\uDD0D", colorClass: "text-sky-400" },
  offer_sent: { icon: "\uD83E\uDD1D", colorClass: "text-purple-400" },
  offer_received: { icon: "\uD83E\uDD1D", colorClass: "text-purple-400" },
  accept: { icon: "\u2713", colorClass: "text-green-400" },
  deliver: { icon: "\u2713", colorClass: "text-green-400" },
  received: { icon: "\u2713", colorClass: "text-green-400" },
  reject: { icon: "\u2717", colorClass: "text-amber-400" },
  error: { icon: "\u26A0", colorClass: "text-red-400" },
  comment_sent: { icon: "\uD83D\uDCAC", colorClass: "text-amber-400" },
  comment_received: { icon: "\uD83D\uDCAC", colorClass: "text-amber-400" },
};

export const D2ATab: React.FC<D2ATabProps> = ({
  content, agentState, mobile, identity, principalText,
  onValidate, onFlag, onTabChange, onTranslate, isItemTranslating,
}) => {
  const { agentProfile, agentProfileLoading, nostrKeys, refreshAgentProfile, wotGraph, sendComment, d2aComments } = useAgent();
  const [subTab, setSubTab] = useState<SubTab>("exchanges");
  const [peerSortKey, setPeerSortKey] = useState<PeerSortKey>("effectiveTrust");
  const [expanded, setExpanded] = useState<string | null>(null);
  const handleToggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);
  const [commentOpen, setCommentOpen] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [npubCopyState, setNpubCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showProfileInfo, setShowProfileInfo] = useState(true);
  const [groups, setGroups] = useState<CurationGroup[]>(() => loadGroups());
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
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

  const peerStats = useMemo(() => {
    const reputations = loadReputations();
    const stats = computePeerStats(content, reputations, wotGraph ?? null);
    return sortPeerStats(stats, peerSortKey);
  }, [content, wotGraph, peerSortKey]);

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

  const counts: Record<SubTab, number> = {
    exchanges: d2aReceived.length,
    published: published.length,
    matches: matches.length,
    peers: peerStats.length,
    groups: groups.length,
  };

  const subTabs: { id: SubTab; label: string; emoji: string }[] = [
    { id: "exchanges", label: "Exchanges", emoji: "\u21C4" },
    { id: "published", label: "Published", emoji: "\u2713" },
    { id: "matches", label: "Matches", emoji: "\u26A1" },
    { id: "peers", label: "Peers", emoji: "\uD83D\uDC65" },
    { id: "groups", label: "Groups", emoji: "\uD83D\uDCCB" },
  ];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className={cn("mb-8", !mobile && "mb-12")}>
        <h1 data-testid="aegis-d2a-heading" className={cn(
          "font-bold leading-tight tracking-tight text-foreground m-0",
          mobile ? "text-[22px]" : "text-display"
        )}>
          D2A Activity
        </h1>
        <p data-testid="aegis-d2a-status" className={cn("text-muted-foreground mt-2", mobile ? "text-body-sm" : "text-body")}>
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
            <div className={cn(surfaceCardClass(mobile), "mb-4 flex gap-3 flex-wrap items-start")}>
              {/* Avatar */}
              <div
                className="rounded-full border-2 border-green-400 overflow-hidden shrink-0 bg-card flex items-center justify-center"
                style={{ width: avatarSize, height: avatarSize }}
              >
                {profilePicture && !avatarError ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={profilePicture}
                    alt="Agent"
                    className="w-full h-full object-cover"
                    onError={() => setAvatarError(true)}
                  />
                ) : (
                  <span style={{ fontSize: avatarSize * 0.5 }} className="opacity-40">{"\uD83E\uDD16"}</span>
                )}
              </div>

              {/* Center: name + npub + about + website */}
              <div className="flex-1 min-w-[120px]">
                {/* Name row */}
                <div className={cn("font-bold text-foreground mb-0.5 flex items-center gap-2", mobile ? "text-body" : "text-h3")}>
                  {profileName}
                  {agentProfileLoading && (
                    <span className="text-caption text-disabled font-normal">...</span>
                  )}
                </div>

                {/* npub + copy */}
                <div className="flex items-center gap-2 relative mb-1">
                  <code className="font-mono text-caption text-purple-400 tracking-wide">
                    {formatNpub(agentState.myPubkey, (agentState.myPubkey?.slice(0, 12) ?? "") + "\u2026")}
                  </code>
                  <button
                    onClick={() => {
                      const npub = fullNpub(agentState.myPubkey);
                      if (!npub) { setNpubCopyState("failed"); setTimeout(() => setNpubCopyState("idle"), 2000); return; }
                      navigator.clipboard.writeText(npub).then(() => {
                        setNpubCopyState("copied");
                        setTimeout(() => setNpubCopyState("idle"), 2000);
                      }).catch(() => {
                        setNpubCopyState("failed");
                        setTimeout(() => setNpubCopyState("idle"), 2000);
                      });
                    }}
                    className={cn(
                      "bg-transparent border border-border rounded-sm px-1.5 py-px text-caption cursor-pointer transition-fast font-sans leading-snug",
                      npubCopyState === "copied" ? "text-green-400"
                        : npubCopyState === "failed" ? "text-red-400"
                        : "text-muted-foreground"
                    )}
                  >
                    {npubCopyState === "copied" ? "Copied!" : npubCopyState === "failed" ? "Failed" : "Copy npub"}
                  </button>
                  {npubCopyState === "copied" && (
                    <div className="absolute top-full left-0 mt-1 bg-navy-lighter border border-border rounded-sm px-2 py-1 font-mono text-caption text-purple-400 whitespace-nowrap z-10 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                      {fullNpub(agentState.myPubkey)}
                    </div>
                  )}
                </div>

                {/* About (optional) */}
                {agentProfile?.about && (
                  <p className="text-body-sm text-tertiary leading-normal m-0 mb-1 overflow-hidden text-ellipsis [-webkit-line-clamp:2] [-webkit-box-orient:vertical] [display:-webkit-box]">
                    {agentProfile.about}
                  </p>
                )}

                {/* Website (optional) */}
                {agentProfile?.website && (
                  <a
                    href={agentProfile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-caption text-cyan-400 no-underline inline-flex items-center gap-1"
                  >
                    {"\uD83D\uDD17"} {agentProfile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                )}
              </div>

              {/* Right: status + edit */}
              <div className="text-right shrink-0 flex flex-col gap-2 items-end">
                <span className="text-caption font-bold px-2 py-0.5 rounded-full uppercase bg-emerald-400/[0.12] text-green-400">
                  Active
                </span>
                <div className="text-caption text-muted-foreground">
                  {agentState.peers.length} peers {"\u00B7"} {agentState.sentItems}{"\u2191"} {agentState.receivedItems}{"\u2193"}
                </div>
                {nostrKeys && principalText && (
                  <button
                    onClick={() => setShowProfileEdit(true)}
                    className="flex items-center gap-1 bg-transparent border border-border rounded-sm px-2 py-0.5 text-caption text-muted-foreground cursor-pointer transition-fast font-sans"
                  >
                    <PencilIcon s={10} /> Edit Profile
                  </button>
                )}
              </div>
            </div>

            {/* Explanatory text block */}
            {showProfileInfo && (
              <div className={cn(surfaceCardClass(mobile), "mb-4 border-l-[3px] border-l-purple-400", mobile ? "p-3" : "p-4")}>
                <div className="text-body-sm text-muted-foreground leading-relaxed">
                  <p className="m-0 mb-2">
                    This account was auto-generated from your Internet Identity as your Aegis agent{"'"}s Nostr account.
                  </p>
                  <p className="m-0 mb-2">
                    Your {onTabChange ? (
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); onTabChange("settings:account"); }}
                        className="text-purple-400 underline cursor-pointer"
                      >linked main Nostr account (npub)</a>
                    ) : (
                      "linked main Nostr account (npub)"
                    )} is used only for the follow graph (WoT). All posts come from this agent account.
                  </p>
                  <p className="m-0">
                    The icon, name, and about set here are published as a Nostr Kind 0 profile, visible from other Nostr clients.
                  </p>
                </div>
                <button
                  onClick={() => setShowProfileInfo(false)}
                  className="bg-transparent border-none cursor-pointer text-purple-400 text-caption font-semibold font-[inherit] mt-2 p-0"
                >
                  Hide
                </button>
              </div>
            )}
            {!showProfileInfo && (
              <button
                onClick={() => setShowProfileInfo(true)}
                className="bg-transparent border-none cursor-pointer text-disabled text-caption font-[inherit] mb-4 p-0"
              >
                Learn more about this agent account
              </button>
            )}

          </>
        );
      })()}

      {/* Profile edit modal */}
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
        <div className={cn(surfaceCardClass(mobile), "mb-4", mobile ? "p-3" : "p-4")}>
          <div className="text-caption font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Activity Log
          </div>
          {(showAllLogs ? agentState.activityLog.slice(0, 20) : agentState.activityLog.slice(0, 5)).map((entry: ActivityLogEntry) => {
            const meta = LOG_ICONS[entry.type] || { icon: "\u2022", colorClass: "text-muted-foreground" };
            return (
              <div key={entry.id} className="flex items-center gap-2 py-1 text-caption border-b border-border">
                <span className={cn("shrink-0 w-[18px] text-center", meta.colorClass)}>{meta.icon}</span>
                <span className="text-secondary-foreground flex-1">
                  {entry.message}
                  {entry.peerId && (
                    <span className="text-disabled font-mono ml-1">
                      {entry.peerId.slice(0, 8)}...
                    </span>
                  )}
                </span>
                <span className="text-disabled shrink-0 text-caption">
                  {relativeTime(entry.timestamp)}
                </span>
              </div>
            );
          })}
          {agentState.activityLog.length > 5 && (
            <button
              onClick={() => setShowAllLogs(!showAllLogs)}
              className="bg-transparent border-none cursor-pointer text-purple-400 text-caption font-semibold font-[inherit] mt-2 p-0"
            >
              {showAllLogs ? "Show less" : `Show more (${agentState.activityLog.length})`}
            </button>
          )}
        </div>
      )}

      {/* Sub-tab selector */}
      <div className={cn(
        "flex mb-4 bg-card rounded-md border border-border p-1",
        mobile ? "gap-0.5" : "gap-1"
      )}>
        {subTabs.map(st => (
          <button
            key={st.id}
            data-testid={`d2a-tab-${st.id}`}
            onClick={() => setSubTab(st.id)}
            title={mobile ? st.label : undefined}
            className={cn(
              "flex-1 flex items-center justify-center border-none cursor-pointer font-[inherit] text-body-sm font-semibold rounded-sm transition-fast",
              mobile ? "gap-0.5 px-2 py-2" : "gap-1 px-3 py-2",
              subTab === st.id ? "bg-navy-lighter text-purple-400" : "bg-transparent text-muted-foreground"
            )}
          >
            <span>{st.emoji}</span>
            {!mobile && st.label}
            {counts[st.id] > 0 && (
              <span className={cn(
                "text-caption font-bold px-1.5 py-px rounded-full",
                subTab === st.id ? "bg-purple-400/15 text-purple-400" : "bg-navy-lighter text-disabled"
              )}>
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
            d2aReceived.map((item, i) => {
              const contentHash = hashContent(item.text);
              const itemComments = d2aComments.filter(c => c.contentHash === contentHash);
              const peerPk = item.nostrPubkey;
              return (
                <div key={item.id} style={{ animation: `slideUp .3s ease ${i * 0.06}s both` }}>
                  <ContentCard
                    item={item}
                    expanded={expanded === item.id}
                    onToggle={handleToggle}
                    onValidate={onValidate}
                    onFlag={onFlag}
                    onTranslate={onTranslate}
                    isTranslating={isItemTranslating?.(item.id)}
                    mobile={mobile}
                  />
                  {expanded === item.id && peerPk && (
                    <div className={cn("pb-3 -mt-2 mb-2", mobile ? "px-4" : "px-5")}>
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          onClick={() => setCommentOpen(commentOpen === item.id ? null : item.id)}
                          className={cn(
                            "bg-transparent border border-border rounded-sm px-2 py-px text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
                            commentOpen === item.id ? "text-amber-400" : "text-muted-foreground"
                          )}
                        >
                          Comment{itemComments.length > 0 ? ` (${itemComments.length})` : ""}
                        </button>
                      </div>
                      {itemComments.length > 0 && (
                        <CommentThread comments={itemComments} currentUserPk={nostrKeys?.pk} />
                      )}
                      {commentOpen === item.id && (
                        <CommentInput
                          contentHash={contentHash}
                          contentTitle={item.text.slice(0, 80)}
                          peerPubkey={peerPk}
                          onSend={(payload: D2ACommentPayload) => {
                            void sendComment(peerPk, payload).catch(err => console.warn("[d2a] sendComment failed:", err));
                            setCommentOpen(null);
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })
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
              action={onTabChange ? () => onTabChange("settings:agent") : undefined}
              actionLabel="Enable in Settings →"
            />
          )}
        </div>
      )}

      {/* Published section */}
      {subTab === "published" && (
        <div>
          <p className="text-body-sm text-muted-foreground mt-0 mb-4">
            Content you{"'"}ve validated as quality. These signals demonstrate your curation taste and are shared with D2A peers during exchanges.
          </p>
          {published.length > 0 ? (
            published.map((item, i) => (
              <div key={item.id} style={{ animation: `slideUp .3s ease ${i * 0.06}s both` }}>
                <div className={cn(surfaceCardClass(mobile), "mb-2 flex gap-3 items-start")}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-bold text-secondary-foreground font-mono text-body-sm">{item.author}</span>
                      <span className="text-caption text-muted-foreground bg-navy-lighter px-2 py-0.5 rounded-sm">{item.platform || item.source}</span>
                      <span className="text-caption text-disabled">{item.timestamp}</span>
                    </div>
                    <p className={cn(
                      "text-secondary-foreground leading-normal m-0 overflow-hidden text-ellipsis [-webkit-line-clamp:3] [-webkit-box-orient:vertical] [display:-webkit-box]",
                      mobile ? "text-body-sm" : "text-body"
                    )}>
                      {item.text}
                    </p>
                  </div>
                  {item.scores && (
                    <div className="text-center shrink-0 px-2 py-1 bg-navy-lighter rounded-sm">
                      <div className="text-h3 font-bold text-green-400 font-mono">
                        {item.scores.composite.toFixed(1)}
                      </div>
                      <div className="text-tiny text-muted-foreground uppercase">Score</div>
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
            <div className={cn(surfaceCardClass(mobile), "text-center p-10")}>
              <div className="text-[32px] mb-3 animate-pulse">{"\u26A1"}</div>
              <div className="text-h3 font-semibold text-secondary-foreground">Loading match records...</div>
            </div>
          ) : matches.length > 0 ? (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-h3 font-semibold text-purple-400">
                  Fee-Paid Matches
                </span>
                <InfoTooltip text="On-chain records of D2A content exchanges with fee payments. 80% goes to the content provider, 20% to the protocol." mobile={mobile} />
              </div>
              {matches.map((m, i) => {
                const isSender = principalText && m.senderPrincipal.toText() === principalText;
                return (
                  <div key={m.id} className={cn(surfaceCardClass(mobile), "mb-2")} style={{ animation: `slideUp .3s ease ${i * 0.04}s both` }}>
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <div>
                        <span className={cn(
                          "text-caption font-bold px-2 py-0.5 rounded-full uppercase",
                          isSender ? "bg-emerald-400/[0.12] text-green-400" : "bg-sky-400/[0.12] text-sky-400"
                        )}>
                          {isSender ? "Sent" : "Received"}
                        </span>
                        <span className="text-caption text-muted-foreground ml-2">
                          {isSender ? truncPrincipal(m.receiverPrincipal) : truncPrincipal(m.senderPrincipal)}
                        </span>
                      </div>
                      <span className="text-caption text-disabled">
                        {formatTimestamp(m.createdAt)}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-2 flex-wrap">
                      <div>
                        <span className="text-caption text-muted-foreground uppercase">Fee </span>
                        <span className="font-mono font-semibold text-amber-400 text-body-sm">
                          {formatICP(m.feeAmount)} ICP
                        </span>
                      </div>
                      {isSender && (
                        <div>
                          <span className="text-caption text-muted-foreground uppercase">Earned </span>
                          <span className="font-mono font-semibold text-green-400 text-body-sm">
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
                  className={cn(
                    "w-full p-3 mt-2 bg-card border border-border rounded-md text-purple-400 text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast",
                    matchLoading && "opacity-50"
                  )}
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

      {/* Peers section */}
      {subTab === "peers" && (
        <div>
          {peerStats.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-h3 font-semibold text-secondary-foreground">
                  D2A Peers ({peerStats.length})
                </span>
                <select
                  value={peerSortKey}
                  onChange={e => setPeerSortKey(e.target.value as PeerSortKey)}
                  className="bg-card border border-border rounded-sm px-2 py-1 text-secondary-foreground text-caption font-[inherit] cursor-pointer"
                >
                  <option value="effectiveTrust">Trust</option>
                  <option value="itemsReceived">Items</option>
                  <option value="qualityRate">Quality</option>
                  <option value="reputation">Rep Score</option>
                </select>
              </div>
              {peerStats.map((peer, i) => (
                <div key={peer.pubkey} className={cn(surfaceCardClass(mobile), "mb-2")} style={{ animation: `slideUp .3s ease ${i * 0.04}s both` }}>
                  <div className="flex items-center gap-3">
                    {/* Avatar placeholder */}
                    <div className="size-9 rounded-full bg-navy-lighter border border-border flex items-center justify-center shrink-0 text-[16px]">
                      {"\uD83D\uDC64"}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-body-sm font-semibold text-secondary-foreground">
                          {peer.displayName}
                        </span>
                        <TrustTierBadge tier={peer.trustTier} />
                      </div>
                      <div className="flex gap-3 mt-1 flex-wrap">
                        <span className="text-caption text-muted-foreground">
                          {peer.itemsReceived} received
                        </span>
                        <span className="text-caption text-green-400">
                          {peer.validated} validated
                        </span>
                        <span className="text-caption text-red-400">
                          {peer.flagged} flagged
                        </span>
                      </div>
                    </div>

                    {/* Quality bar + score */}
                    <div className="text-right shrink-0">
                      <div className={cn(
                        "text-h3 font-bold font-mono",
                        peer.qualityRate >= 0.7 ? "text-green-400" : peer.qualityRate >= 0.4 ? "text-amber-400" : "text-red-400"
                      )}>
                        {(peer.qualityRate * 100).toFixed(0)}%
                      </div>
                      <div className="text-tiny text-muted-foreground uppercase">Quality</div>
                      {/* Mini quality bar */}
                      <div className="w-12 h-[3px] bg-navy-lighter rounded-sm mt-0.5 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-sm",
                            peer.qualityRate >= 0.7 ? "bg-green-400" : peer.qualityRate >= 0.4 ? "bg-amber-400" : "bg-red-400"
                          )}
                          style={{ width: `${peer.qualityRate * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bottom row: trust details */}
                  <div className="flex gap-4 mt-2 pt-2 border-t border-border flex-wrap">
                    <div>
                      <span className="text-caption text-muted-foreground uppercase">WoT </span>
                      <span className="font-mono font-semibold text-body-sm text-purple-400">
                        {(peer.wotScore * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-caption text-muted-foreground uppercase">Rep </span>
                      <span className={cn("font-mono font-semibold text-body-sm", peer.reputation.score >= 0 ? "text-green-400" : "text-red-400")}>
                        {peer.reputation.score > 0 ? "+" : ""}{peer.reputation.score}
                      </span>
                    </div>
                    <div>
                      <span className="text-caption text-muted-foreground uppercase">Trust </span>
                      <span className="font-mono font-semibold text-body-sm text-cyan-400">
                        {(peer.effectiveTrust * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <EmptyState
              emoji={"\uD83D\uDC65"}
              title="No peers yet"
              subtitle="Peers appear here after your D2A agent exchanges content. Enable the agent in Settings to get started."
              action={onTabChange ? () => onTabChange("settings:agent") : undefined}
              actionLabel="Enable in Settings →"
            />
          )}
        </div>
      )}

      {/* Groups section */}
      {subTab === "groups" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-h3 font-semibold text-secondary-foreground">
              Curation Groups
            </span>
            {nostrKeys && (
              <button
                onClick={() => setShowCreateGroup(true)}
                className="px-3 py-1 bg-purple-400/[0.07] border border-purple-400/20 rounded-sm text-purple-400 text-body-sm font-bold cursor-pointer font-[inherit] transition-fast"
              >
                + Create Group
              </button>
            )}
          </div>

          {groups.length > 0 ? (
            groups.map(group => {
              const feed = buildGroupFeed(group, content);
              const isOwner = group.ownerPk === nostrKeys?.pk;
              const isExpanded = expandedGroup === group.id;
              return (
                <div key={group.id}>
                  <GroupCard
                    group={group}
                    feedCount={feed.length}
                    isOwner={isOwner}
                    expanded={isExpanded}
                    onToggle={() => setExpandedGroup(isExpanded ? null : group.id)}
                    onDelete={isOwner ? () => {
                      removeGroup(group.id);
                      setGroups(loadGroups());
                      if (expandedGroup === group.id) setExpandedGroup(null);
                    } : undefined}
                    mobile={mobile}
                  />
                  {isExpanded && (
                    <GroupFeedView
                      group={group}
                      feed={feed}
                      isOwner={isOwner}
                      currentUserPk={nostrKeys?.pk}
                      onValidate={onValidate}
                      onFlag={onFlag}
                      onAddMember={isOwner ? (pk: string) => {
                        addMember(group.id, pk);
                        setGroups(loadGroups());
                      } : undefined}
                      onRemoveMember={isOwner ? (pk: string) => {
                        removeMember(group.id, pk);
                        setGroups(loadGroups());
                      } : undefined}
                      onSync={nostrKeys ? () => {
                        void publishCurationList(nostrKeys.sk, {
                          dTag: group.dTag,
                          name: group.name,
                          description: group.description,
                          members: group.members,
                          topics: group.topics,
                          ownerPk: group.ownerPk,
                          createdAt: group.createdAt,
                        }).catch(err => console.warn("[d2a] publishCurationList failed:", err));
                      } : undefined}
                      onTranslate={onTranslate}
                      isItemTranslating={isItemTranslating}
                      mobile={mobile}
                    />
                  )}
                </div>
              );
            })
          ) : (
            <EmptyState
              emoji={"\uD83D\uDCCB"}
              title="No curation groups yet"
              subtitle="Create a group to collaboratively curate content with trusted peers. Groups use Nostr lists for decentralized membership."
            />
          )}

          {showCreateGroup && nostrKeys && (
            <CreateGroupModal
              ownerPk={nostrKeys.pk}
              onClose={() => setShowCreateGroup(false)}
              onCreate={(group) => {
                saveGroup(group);
                setGroups(loadGroups());
                setShowCreateGroup(false);
                void publishCurationList(nostrKeys.sk, {
                  dTag: group.dTag,
                  name: group.name,
                  description: group.description,
                  members: group.members,
                  topics: group.topics,
                  ownerPk: group.ownerPk,
                  createdAt: group.createdAt,
                }).catch(err => console.warn("[d2a] publishCurationList failed:", err));
              }}
              mobile={mobile}
            />
          )}
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
    <div className="text-center p-10 text-muted-foreground bg-card rounded-lg border border-border">
      <div className="text-[32px] mb-3">{emoji}</div>
      <div className="text-h3 font-semibold text-secondary-foreground">{title}</div>
      <div className="text-body-sm mt-2">{subtitle}</div>
      {checklist && (
        <div className="text-left inline-block mt-3">
          {checklist.map((item) => (
            <div key={item.text} className={cn(
              "flex gap-2 items-center text-body-sm py-1",
              item.done ? "text-green-400" : "text-disabled"
            )}>
              <span className="shrink-0">{item.done ? "\u2713" : "\u25CC"}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      )}
      {action && actionLabel && (
        <div className="mt-4">
          <button onClick={action} className="px-4 py-2 bg-navy-lighter border border-emphasis rounded-md text-purple-400 text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast">
            {actionLabel} &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
