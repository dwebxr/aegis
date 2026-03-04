"use client";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard, deriveScoreTags } from "@/components/ui/ContentCard";
import { GearIcon } from "@/components/icons";
import { fonts, colors, space, type as t, radii, transitions, scoreGrade } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import { exportContentCSV, exportContentJSON } from "@/lib/utils/export";
import { extractYouTubeVideoId, youTubeEmbedUrl } from "@/lib/utils/youtube";
import { useFilterMode } from "@/contexts/FilterModeContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { getContext, hasEnoughData } from "@/lib/preferences/engine";
import { D2ANetworkMini } from "@/components/ui/D2ANetworkMini";
import { BriefingClassificationBadge } from "@/components/ui/BriefingClassificationBadge";
import {
  applyDashboardFilters,
  computeDashboardTop3,
  computeTopicSpotlight,
  computeDashboardSaved,
  computeUnreviewedQueue,
  clusterByStory,
} from "@/lib/dashboard/utils";
import { SerendipityBadge } from "@/components/filtering/SerendipityBadge";
import type { SerendipityItem } from "@/lib/filtering/serendipity";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { CommandPalette } from "@/components/ui/CommandPalette";
import type { PaletteCommand } from "@/components/ui/CommandPalette";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { NewItemsBar } from "@/components/ui/NewItemsBar";
import { useSources } from "@/contexts/SourceContext";
import { useDemo } from "@/contexts/DemoContext";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

function ScorePill({ gr, tag }: { gr: ReturnType<typeof scoreGrade>; tag: { label: string; color: string } | null }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: radii.pill,
      background: `${gr.color}12`, border: `1px solid ${gr.color}25`,
      fontSize: t.caption.size, fontWeight: 700, flexShrink: 0,
    }}>
      <span style={{ color: gr.color, fontFamily: fonts.mono }}>{gr.grade}</span>
      {tag && (
        <>
          <span style={{ color: colors.text.disabled }}>&middot;</span>
          <span style={{ color: tag.color, textTransform: "uppercase", fontSize: 9, letterSpacing: 0.5, whiteSpace: "nowrap" }}>{tag.label}</span>
        </>
      )}
    </div>
  );
}

function ThumbnailArea({ item, gr, gradeSize, imgFailed, onImgError, overlay }: {
  item: ContentItem;
  gr: ReturnType<typeof scoreGrade>;
  gradeSize: number;
  imgFailed: boolean;
  onImgError: () => void;
  overlay?: React.ReactNode;
}) {
  const showImg = item.imageUrl && !imgFailed;
  const hasLink = item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl);
  const ytVideoId = item.sourceUrl ? extractYouTubeVideoId(item.sourceUrl) : null;

  const inner = (
    <div style={{
      position: "relative", width: "100%", aspectRatio: "16/9",
      overflow: "hidden",
      background: showImg ? colors.bg.raised : `linear-gradient(135deg, ${gr.bg}, ${colors.bg.raised})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: space[1],
      cursor: !ytVideoId && hasLink ? "pointer" : undefined,
    }}>
      {ytVideoId ? (
        <iframe
          src={youTubeEmbedUrl(ytVideoId)}
          title={item.text?.slice(0, 60) || "YouTube video"}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : showImg ? (
        /* eslint-disable-next-line @next/next/no-img-element -- dashboard card OG thumbnail */
        <img src={item.imageUrl!} alt="" loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          onError={onImgError} />
      ) : (
        <>
          <span style={{ fontSize: gradeSize, fontWeight: 800, color: gr.color, fontFamily: fonts.mono }}>{gr.grade}</span>
          <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>{item.platform || item.source}</span>
        </>
      )}
      {overlay && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: ytVideoId ? "none" : "auto" as const }}>
          {overlay}
        </div>
      )}
    </div>
  );

  // When YouTube is embedded, don't wrap in <a> — the iframe is the interaction
  if (!ytVideoId && hasLink) {
    return (
      <a href={item.sourceUrl!} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none" }}>
        {inner}
      </a>
    );
  }
  return inner;
}

const inlineVBtnStyle: React.CSSProperties = {
  padding: `2px ${space[2]}px`, borderRadius: radii.sm,
  background: colors.green.bg, border: `1px solid ${colors.green.border}`,
  color: colors.green[400], fontSize: t.caption.size, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit", transition: transitions.fast,
};
const inlineFBtnStyle: React.CSSProperties = {
  padding: `2px ${space[2]}px`, borderRadius: radii.sm,
  background: colors.red.bg, border: `1px solid ${colors.red.border}`,
  color: colors.red[400], fontSize: t.caption.size, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit", transition: transitions.fast,
};
const inlineBBtnStyle: React.CSSProperties = {
  padding: `2px ${space[2]}px`, borderRadius: radii.sm,
  background: "transparent", border: `1px solid ${colors.border.default}`,
  color: colors.text.muted, fontSize: t.caption.size, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit", transition: transitions.fast,
};
const inlineBBtnActiveStyle: React.CSSProperties = {
  ...inlineBBtnStyle,
  background: `${colors.amber[400]}18`,
  border: `1px solid ${colors.amber[400]}30`,
  color: colors.amber[400],
};

function AgentKnowledgePills({ agentContext, profile }: {
  agentContext: { highAffinityTopics: string[]; trustedAuthors: string[] };
  profile: { calibration: { qualityThreshold: number }; totalValidated: number; totalFlagged: number };
}) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
        {agentContext.highAffinityTopics.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>Interests:</span>
            {agentContext.highAffinityTopics.slice(0, 6).map(topic => (
              <span key={topic} style={{
                fontSize: t.caption.size, padding: `1px ${space[2]}px`,
                background: `${colors.cyan[400]}10`, border: `1px solid ${colors.cyan[400]}20`,
                borderRadius: radii.pill, color: colors.cyan[400],
              }}>{topic}</span>
            ))}
          </div>
        )}
        {agentContext.trustedAuthors.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>Trusted:</span>
            {agentContext.trustedAuthors.slice(0, 4).map(author => (
              <span key={author} style={{
                fontSize: t.caption.size, padding: `1px ${space[2]}px`,
                background: `${colors.green[400]}10`, border: `1px solid ${colors.green[400]}20`,
                borderRadius: radii.pill, color: colors.green[400],
              }}>{author}</span>
            ))}
          </div>
        )}
        {agentContext.highAffinityTopics.length === 0 && agentContext.trustedAuthors.length === 0 && (
          <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>
            Validate or flag content to teach your agent.
          </span>
        )}
      </div>
      <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2] }}>
        Threshold: {profile.calibration.qualityThreshold.toFixed(1)} &middot; Reviews: {profile.totalValidated + profile.totalFlagged}
      </div>
    </>
  );
}

const EMPTY_SECTIONS = { filteredDiscoveries: [] as SerendipityItem[], unreviewedQueue: [] as ContentItem[], dashboardSaved: [] as ContentItem[] };

interface DashboardTabProps {
  content: ContentItem[];
  mobile?: boolean;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  isLoading?: boolean;
  wotLoading?: boolean;
  onTabChange?: (tab: string) => void;
  discoveries?: SerendipityItem[];
  pendingCount?: number;
  onFlushPending?: () => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ content, mobile, onValidate, onFlag, isLoading, wotLoading, onTabChange, discoveries = [], pendingCount = 0, onFlushPending }) => {
  const { filterMode } = useFilterMode();
  const { sources } = useSources();
  const { isDemoMode } = useDemo();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<"all" | "quality" | "slop" | "validated" | "bookmarked">("quality");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAllContent, setShowAllContent] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const markImgFailed = (id: string) =>
    setFailedImages(prev => { const next = new Set(prev); next.add(id); return next; });
  // Clear stale failedImages when content items are added/removed (e.g., after backfill)
  const prevContentLenRef = useRef(content.length);
  useEffect(() => {
    if (content.length !== prevContentLenRef.current) {
      setFailedImages(new Set());
      prevContentLenRef.current = content.length;
    }
  }, [content.length]);
  const [homeMode, setHomeMode] = useState<"feed" | "dashboard">(() => {
    if (typeof window === "undefined") return "feed";
    try { return localStorage.getItem("aegis-home-mode") === "dashboard" ? "dashboard" : "feed"; }
    catch { return "feed"; }
  });
  const { profile, setTopicAffinity, addFilterRule, bookmarkItem, unbookmarkItem } = usePreferences();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("aegis-home-mode", homeMode); } catch { console.debug("[dashboard] localStorage unavailable"); }
  }, [homeMode]);

  const { todayContent, todayQual, todaySlop, uniqueSources, availableSources, dailyQuality, dailySlop } = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = now - dayMs;

    const todayContent = content.filter(c => c.createdAt >= todayStart);
    const todayQual = todayContent.filter(c => c.verdict === "quality");
    const todaySlop = todayContent.filter(c => c.verdict === "slop");
    const uniqueSources = new Set(content.map(c => c.source));
    const availableSources = Array.from(uniqueSources).sort();

    const dailyQuality: number[] = [];
    const dailySlop: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - (i + 1) * dayMs;
      const dayEnd = now - i * dayMs;
      const dayItems = content.filter(c => c.createdAt >= dayStart && c.createdAt < dayEnd);
      const dayQual = dayItems.filter(c => c.verdict === "quality").length;
      const dayTotal = dayItems.length;
      dailyQuality.push(dayTotal > 0 ? Math.round((dayQual / dayTotal) * 100) : 0);
      dailySlop.push(dayItems.filter(c => c.verdict === "slop").length);
    }
    return { todayContent, todayQual, todaySlop, uniqueSources, availableSources, dailyQuality, dailySlop };
  }, [content]);

  useEffect(() => {
    setExpanded(null);
    setShowAllContent(false);
    setExpandedClusters(new Set());
  }, [verdictFilter, sourceFilter]);

  const filteredContent = useMemo(() => {
    if (verdictFilter === "bookmarked") {
      const bookmarkSet = new Set(profile.bookmarkedIds ?? []);
      return content.filter(c => bookmarkSet.has(c.id)).sort((a, b) => b.createdAt - a.createdAt);
    }
    return applyDashboardFilters(content, verdictFilter, sourceFilter);
  }, [content, verdictFilter, sourceFilter, profile.bookmarkedIds]);

  const clusteredContent = useMemo(
    () => homeMode === "feed" ? clusterByStory(filteredContent) : [],
    [filteredContent, homeMode],
  );

  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  // State for collapsible dashboard sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  // State for Topic Spotlight collapsible topics
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  const hasActiveFilter = verdictFilter !== "all" || sourceFilter !== "all";

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const toggleTopic = useCallback((topic: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
  }, []);

  const agentContext = useMemo(() => {
    if (!hasEnoughData(profile)) return null;
    return getContext(profile);
  }, [profile]);

  // Dashboard computations: skipped in Feed mode, computed only when homeMode === "dashboard".
  const contentRef = useRef(content);
  contentRef.current = content;

  const dashboardTop3 = useMemo(() => {
    if (homeMode !== "dashboard") return [];
    return computeDashboardTop3(contentRef.current, profile, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, homeMode, content.length]);

  const dashboardTopicSpotlight = useMemo(() => {
    if (homeMode !== "dashboard") return [];
    return computeTopicSpotlight(contentRef.current, profile, dashboardTop3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, dashboardTop3, homeMode, content.length]);

  // Initialize first topic as expanded
  useEffect(() => {
    if (dashboardTopicSpotlight.length > 0 && expandedTopics.size === 0) {
      setExpandedTopics(new Set([dashboardTopicSpotlight[0].topic]));
    }
  }, [dashboardTopicSpotlight, expandedTopics.size]);

  const { filteredDiscoveries, unreviewedQueue, dashboardSaved } = useMemo(() => {
    if (homeMode !== "dashboard") return EMPTY_SECTIONS;
    // 1. Top sections: Top3 + Spotlight
    const topIds = new Set(dashboardTop3.map(c => c.item.id));
    for (const group of dashboardTopicSpotlight) {
      for (const item of group.items) topIds.add(item.id);
    }

    // 2. Discoveries
    const filtDisc = discoveries.filter(d => !topIds.has(d.item.id)).slice(0, 3);
    for (const d of filtDisc) topIds.add(d.item.id);

    // 3. Unreviewed queue
    const queue = computeUnreviewedQueue(contentRef.current, topIds).slice(0, 3);
    for (const item of queue) topIds.add(item.id);

    // 4. Saved/Bookmarked
    const saved = computeDashboardSaved(contentRef.current, profile.bookmarkedIds ?? [], topIds).slice(0, 3);

    return { filteredDiscoveries: filtDisc, unreviewedQueue: queue, dashboardSaved: saved };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardTop3, dashboardTopicSpotlight, discoveries, profile.bookmarkedIds, homeMode, content.length]);

  // Signal feedback loop
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; key: number } | null>(null);
  const [agentKnowsHighlight, setAgentKnowsHighlight] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const showFeedback = useCallback((text: string) => {
    clearTimeout(feedbackTimerRef.current);
    setFeedbackMsg({ text, key: Date.now() });
    setAgentKnowsHighlight(true);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedbackMsg(null);
      setAgentKnowsHighlight(false);
    }, 3500);
  }, []);

  const handleValidateWithFeedback = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    onValidate(id);
    if (item) {
      const parts: string[] = [];
      const topic = item.topics?.[0];
      if (topic) parts.push(`[${topic}] \u2191`);
      if (item.author && item.author !== "You") parts.push(`Trust in ${item.author} \u2191`);
      if (item.scores.composite >= 3.5 && item.scores.composite <= 4.5) parts.push("Threshold relaxed");
      if (parts.length > 0) showFeedback(parts.join("  \u00B7  "));
    }
  }, [onValidate, showFeedback]);

  const handleFlagWithFeedback = useCallback((id: string) => {
    const item = contentRef.current.find(c => c.id === id);
    onFlag(id);
    if (item) {
      const parts: string[] = [];
      const topic = item.topics?.[0];
      if (topic) parts.push(`[${topic}] \u2193`);
      if (item.author && item.author !== "You") parts.push(`${item.author} trust \u2193`);
      if (item.verdict === "quality") parts.push("Threshold tightened");
      if (parts.length > 0) showFeedback(parts.join("  \u00B7  "));
    }
  }, [onFlag, showFeedback]);

  const bookmarkSet = useMemo(() => new Set(profile.bookmarkedIds ?? []), [profile.bookmarkedIds]);

  const bookmarkSetRef = useRef(bookmarkSet);
  bookmarkSetRef.current = bookmarkSet;

  const handleBookmark = useCallback((id: string) => {
    if (bookmarkSetRef.current.has(id)) {
      unbookmarkItem(id);
    } else {
      bookmarkItem(id);
    }
  }, [bookmarkItem, unbookmarkItem]);

  const handleToggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  useEffect(() => {
    return () => { clearTimeout(feedbackTimerRef.current); };
  }, []);

  const feedItemIds = useMemo(() => clusteredContent.slice(0, showAllContent ? 50 : 5).map(c => c.representative.id), [clusteredContent, showAllContent]);

  const { focusedId } = useKeyboardNav({
    items: feedItemIds,
    expandedId: expanded,
    onExpand: setExpanded,
    onValidate: handleValidateWithFeedback,
    onFlag: handleFlagWithFeedback,
    onOpenPalette: () => setPaletteOpen(true),
    enabled: !mobile && homeMode === "feed",
  });

  const paletteCommands: PaletteCommand[] = useMemo(() => [
    { label: "Go to Feed", action: () => setHomeMode("feed") },
    { label: "Go to Dashboard", action: () => setHomeMode("dashboard") },
    { label: "Go to Analytics", action: () => onTabChange?.("analytics") },
    { label: "Go to Settings", action: () => onTabChange?.("settings") },
    { label: "Go to Sources", action: () => onTabChange?.("sources") },
    { label: "Filter: Quality", action: () => setVerdictFilter("quality") },
    { label: "Filter: Slop", action: () => setVerdictFilter("slop") },
    { label: "Filter: All", action: () => setVerdictFilter("all") },
    { label: "Filter: Validated", action: () => setVerdictFilter("validated") },
    { label: "Export CSV", action: () => exportContentCSV(content) },
    { label: "Export JSON", action: () => exportContentJSON(content) },
  ], [onTabChange, content]);

  return (
    <div data-testid="aegis-dashboard" style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space[2], flexWrap: "wrap", gap: space[2] }}>
        <h1 style={{ fontSize: mobile ? t.h1.mobileSz : t.h1.size, fontWeight: t.h1.weight, color: colors.text.primary, margin: 0 }}>
          Home
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
          <div style={{
            display: "flex", gap: space[1],
            background: colors.bg.raised, borderRadius: radii.md,
            padding: space[1], border: `1px solid ${colors.border.default}`,
          }}>
            {(["feed", "dashboard"] as const).map(mode => {
              const active = homeMode === mode;
              return (
                <button
                  key={mode}
                  data-testid={`aegis-home-mode-${mode}`}
                  onClick={() => setHomeMode(mode)}
                  style={{
                    padding: `${space[2]}px ${space[3]}px`,
                    background: active ? colors.bg.surface : "transparent",
                    border: active ? `1px solid ${colors.border.emphasis}` : "1px solid transparent",
                    borderRadius: radii.sm,
                    color: active ? colors.text.primary : colors.text.muted,
                    fontSize: t.bodySm.size,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: transitions.fast,
                    textTransform: "capitalize" as const,
                  }}
                >
                  {mode === "feed" ? "Feed" : "Dashboard"}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => onTabChange?.("settings:feeds")}
            style={{
              display: "inline-flex", alignItems: "center", gap: space[1],
              padding: `${space[1]}px ${space[3]}px`,
              borderRadius: radii.pill,
              background: filterMode === "pro" ? "rgba(56,189,248,0.1)" : colors.bg.raised,
              border: `1px solid ${filterMode === "pro" ? "rgba(56,189,248,0.2)" : colors.border.default}`,
              color: filterMode === "pro" ? colors.sky[400] : colors.text.muted,
              fontSize: t.caption.size, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit", transition: transitions.fast,
            }}
            title="Change in Settings > Feeds"
          >
            {filterMode === "pro" ? "Pro" : "Lite"}
          </button>
          {wotLoading && (
            <span style={{ fontSize: t.caption.size, color: colors.text.disabled, animation: "pulse 2s infinite" }}>
              &#x1F310; WoT...
            </span>
          )}
        </div>
      </div>

      {/* Signal feedback loop message — shown in both modes */}
      {feedbackMsg && (
        <div
          key={feedbackMsg.key}
          style={{
            marginTop: space[2],
            marginBottom: space[2],
            padding: `${space[2]}px ${space[4]}px`,
            background: "rgba(139,92,246,0.06)",
            border: "1px solid rgba(139,92,246,0.15)",
            borderRadius: radii.md,
            fontSize: t.bodySm.size,
            color: colors.purple[400],
            fontWeight: 600,
            textAlign: "center",
            animation: "fadeIn .3s ease",
          }}
        >
          &#x1F4E1; Agent learned: {feedbackMsg.text}
        </div>
      )}

      {homeMode === "feed" && (
        <>
          <div data-testid="aegis-metrics-bar" style={{
            display: "flex", flexWrap: "wrap", alignItems: "center",
            gap: mobile ? space[3] : space[4],
            marginBottom: space[3],
            padding: `${space[2]}px ${space[4]}px`,
            background: colors.bg.surface,
            border: `1px solid ${colors.border.default}`,
            borderRadius: radii.md,
          }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], flex: 1 }}>
              {[
                { icon: "\u{1F6E1}", value: todayQual.length, label: "quality", color: colors.cyan[400] },
                { icon: "\u{1F525}", value: todaySlop.length, label: "burned", color: colors.orange[400] },
                { icon: "\u26A1", value: todayContent.length, label: "eval", color: colors.purple[400] },
                { icon: "\u{1F4E1}", value: uniqueSources.size, label: "sources", color: colors.sky[400] },
              ].map(m => (
                <span key={m.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: t.bodySm.size, color: colors.text.muted }}>
                  <span>{m.icon}</span>
                  <span style={{ fontWeight: 700, color: m.color, fontFamily: fonts.mono }}>{m.value}</span>
                  <span>{m.label}</span>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: space[3], alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 60 }}>
                  <MiniChart data={dailyQuality} color={colors.cyan[400]} h={20} />
                </div>
                <span style={{ fontSize: t.tiny.size, color: colors.cyan[400], fontFamily: fonts.mono }}>
                  {dailyQuality.length > 0 ? dailyQuality[dailyQuality.length - 1] : 0}%
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 60 }}>
                  <MiniChart data={dailySlop} color={colors.orange[500]} h={20} />
                </div>
                <span style={{ fontSize: t.tiny.size, color: colors.orange[500], fontFamily: fonts.mono }}>
                  {dailySlop.length > 0 ? dailySlop[dailySlop.length - 1] : 0}
                </span>
              </div>
            </div>
          </div>

          {/* Content filters */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space[3], flexWrap: "wrap", gap: space[2] }}>
            <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>
              Filtered Signal {hasActiveFilter && <span data-testid="aegis-filter-count" style={{ fontSize: t.bodySm.size, color: colors.text.disabled }}>({filteredContent.length})</span>}
            </div>
            <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
              {([
                { id: "quality" as const, label: "quality" },
                { id: "all" as const, label: "all" },
                { id: "slop" as const, label: "slop" },
                { id: "validated" as const, label: "\u2713 validated" },
                { id: "bookmarked" as const, label: "\uD83D\uDD16 Saved" },
              ]).map(({ id: v, label }) => (
                <button
                  key={v}
                  data-testid={`aegis-filter-${v}`}
                  aria-pressed={verdictFilter === v}
                  onClick={() => setVerdictFilter(v)}
                  style={{
                    padding: `${space[1]}px ${space[3]}px`,
                    background: verdictFilter === v
                      ? (v === "quality" ? colors.green.bg : v === "slop" ? colors.red.bg : v === "validated" ? "rgba(167,139,250,0.06)" : v === "bookmarked" ? `${colors.cyan[500]}08` : colors.bg.raised)
                      : "transparent",
                    border: `1px solid ${verdictFilter === v
                      ? (v === "quality" ? colors.green.border : v === "slop" ? colors.red.border : v === "validated" ? "rgba(167,139,250,0.15)" : v === "bookmarked" ? `${colors.cyan[500]}25` : colors.border.emphasis)
                      : colors.border.default}`,
                    borderRadius: radii.pill,
                    color: verdictFilter === v
                      ? (v === "quality" ? colors.green[400] : v === "slop" ? colors.red[400] : v === "validated" ? colors.purple[400] : v === "bookmarked" ? colors.cyan[400] : colors.text.secondary)
                      : colors.text.disabled,
                    fontSize: t.caption.size,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: transitions.fast,
                    textTransform: v === "bookmarked" ? "none" : "capitalize",
                  }}
                >
                  {label}
                </button>
              ))}
              {availableSources.length > 1 && (
                <select
                  value={sourceFilter}
                  onChange={e => setSourceFilter(e.target.value)}
                  style={{
                    padding: `${space[1]}px ${space[2]}px`,
                    background: sourceFilter !== "all" ? colors.bg.raised : "transparent",
                    border: `1px solid ${sourceFilter !== "all" ? colors.border.emphasis : colors.border.default}`,
                    borderRadius: radii.pill,
                    color: sourceFilter !== "all" ? colors.text.secondary : colors.text.disabled,
                    fontSize: t.caption.size,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                >
                  <option value="all">all sources</option>
                  {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Content list */}
          {isLoading ? (
            <div style={{
              textAlign: "center", padding: space[10],
              color: colors.text.muted, background: colors.bg.surface,
              borderRadius: radii.lg, border: `1px solid ${colors.border.default}`,
              marginBottom: space[4],
            }}>
              <div style={{ fontSize: 32, marginBottom: space[3], animation: "pulse 2s infinite" }}>&#x1F6E1;</div>
              <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>Loading content...</div>
              <div style={{ fontSize: t.bodySm.size, marginTop: space[2] }}>Syncing from Internet Computer</div>
            </div>
          ) : filteredContent.length === 0 ? (
            <>
              {hasActiveFilter ? (
                <div style={{
                  textAlign: "center", padding: space[10],
                  color: colors.text.muted, background: colors.bg.surface,
                  borderRadius: radii.lg, border: `1px solid ${colors.border.default}`,
                  marginBottom: space[4],
                }}>
                  <div style={{ fontSize: 32, marginBottom: space[3] }}>&#x1F50D;</div>
                  <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>No matching content</div>
                  <div style={{ fontSize: t.bodySm.size, marginTop: space[2] }}>Try adjusting your filters</div>
                </div>
              ) : !isDemoMode ? (
                <OnboardingFlow
                  context={{
                    sourcesCount: sources.length,
                    contentCount: content.length,
                    validatedCount: profile.totalValidated,
                    flaggedCount: profile.totalFlagged,
                  }}
                  mobile={mobile}
                  onTabChange={onTabChange}
                />
              ) : (
                <div style={{
                  textAlign: "center", padding: space[10],
                  color: colors.text.muted, background: colors.bg.surface,
                  borderRadius: radii.lg, border: `1px solid ${colors.border.default}`,
                  marginBottom: space[4],
                }}>
                  <div style={{ fontSize: 32, marginBottom: space[3] }}>&#x1F50D;</div>
                  <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>No content yet</div>
                  <div style={{ fontSize: t.bodySm.size, marginTop: space[2] }}>Add sources to start filtering, or try the incinerator for manual evaluation</div>
                </div>
              )}
            </>
          ) : (
            <>
              {pendingCount > 0 && onFlushPending && (
                <NewItemsBar count={pendingCount} onFlush={onFlushPending} />
              )}
              {clusteredContent.slice(0, showAllContent ? 50 : 5).map((cluster, i) => {
                const rep = cluster.representative;
                const hasCluster = cluster.members.length > 1;
                const clusterExpanded = expandedClusters.has(rep.id);
                return (
                  <div key={rep.id} style={{ animation: `slideUp .2s ease ${i * 0.03}s both` }}>
                    {verdictFilter === "validated" && rep.validatedAt && (
                      <div style={{
                        fontSize: t.caption.size, color: colors.purple[400],
                        marginBottom: space[1], marginLeft: space[1],
                        fontFamily: fonts.mono, fontWeight: 600,
                      }}>
                        Validated {new Date(rep.validatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        {" "}
                        {new Date(rep.validatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    <ContentCard
                      item={rep}
                      expanded={expanded === rep.id}
                      onToggle={handleToggle}
                      onValidate={handleValidateWithFeedback}
                      onFlag={handleFlagWithFeedback}
                      onBookmark={handleBookmark}
                      isBookmarked={bookmarkSet.has(rep.id)}
                      onAddFilterRule={addFilterRule}
                      mobile={mobile}
                      focused={focusedId === rep.id}
                      clusterCount={hasCluster ? cluster.members.length - 1 : undefined}
                    />
                    {hasCluster && (
                      <button
                        onClick={() => setExpandedClusters(prev => {
                          const next = new Set(prev);
                          if (next.has(rep.id)) next.delete(rep.id); else next.add(rep.id);
                          return next;
                        })}
                        style={{
                          display: "flex", alignItems: "center", gap: space[1],
                          padding: `${space[1]}px ${space[3]}px`,
                          margin: `${space[1]}px 0 ${space[2]}px ${space[4]}px`,
                          background: "none", border: `1px solid ${colors.border.subtle}`,
                          borderRadius: radii.pill, color: colors.text.muted,
                          fontSize: t.caption.size, fontWeight: 600, cursor: "pointer",
                          fontFamily: "inherit", transition: transitions.fast,
                        }}
                      >
                        <span style={{ transform: clusterExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: transitions.fast, display: "inline-block" }}>&#x25BC;</span>
                        {clusterExpanded ? "Hide" : `+${cluster.members.length - 1} related`}
                        {cluster.sharedTopics.length > 0 && ` \u00B7 ${cluster.sharedTopics.slice(0, 2).join(", ")}`}
                      </button>
                    )}
                    {hasCluster && clusterExpanded && cluster.members.slice(1).map(m => (
                      <div key={m.id} style={{ marginLeft: space[4], borderLeft: `2px solid ${colors.border.subtle}`, paddingLeft: space[3] }}>
                        <ContentCard
                          item={m}
                          expanded={expanded === m.id}
                          onToggle={handleToggle}
                          onValidate={handleValidateWithFeedback}
                          onFlag={handleFlagWithFeedback}
                          onBookmark={handleBookmark}
                          isBookmarked={bookmarkSet.has(m.id)}
                          onAddFilterRule={addFilterRule}
                          mobile={mobile}
                          focused={focusedId === m.id}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
              {clusteredContent.length > 5 && !showAllContent && (
                <button
                  onClick={() => setShowAllContent(true)}
                  style={{
                    width: "100%",
                    padding: `${space[3]}px ${space[4]}px`,
                    background: colors.bg.surface,
                    border: `1px solid ${colors.border.default}`,
                    borderRadius: radii.md,
                    color: colors.text.muted,
                    fontSize: t.bodySm.size,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: transitions.normal,
                    marginTop: space[2],
                  }}
                >
                  Show all ({filteredContent.length} items in {clusteredContent.length} groups)
                </button>
              )}
            </>
          )}

          {/* Agent Knowledge — interest profile */}
          {agentContext && (
            <div style={{
              marginTop: space[4],
              padding: `${space[3]}px ${space[4]}px`,
              background: colors.bg.surface,
              border: `1px solid ${agentKnowsHighlight ? "rgba(139,92,246,0.3)" : colors.border.default}`,
              borderRadius: radii.md,
              transition: "border-color 0.5s ease, box-shadow 0.5s ease",
              boxShadow: agentKnowsHighlight ? "0 0 12px rgba(139,92,246,0.1)" : "none",
            }}>
              <div style={{ fontSize: t.bodySm.size, fontWeight: 600, color: colors.text.tertiary, marginBottom: space[2] }}>
                Your Agent Knows
              </div>
              <AgentKnowledgePills agentContext={agentContext} profile={profile} />
            </div>
          )}

          {/* D2A Network visualization */}
          <D2ANetworkMini mobile={mobile} />
        </>
      )}

      {homeMode === "dashboard" && (
        <div style={{ marginTop: space[3] }}>
          {/* Today's Top 3 — full width */}
          <div data-testid="aegis-top3-section" style={{ marginBottom: space[4] }}>
            <div style={{
              fontSize: t.h3.size, fontWeight: t.h3.weight,
              color: colors.text.tertiary, marginBottom: space[3],
              display: "flex", alignItems: "center", gap: space[2],
            }}>
              <span>⭐</span> Today&#39;s Top 3
              <div style={{ flex: 1 }} />
              <button
                onClick={() => { setHomeMode("feed"); setVerdictFilter("all"); }}
                style={{
                  fontSize: t.caption.size, fontWeight: 600,
                  color: colors.cyan[400], background: "transparent",
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Review All →
              </button>
            </div>
            {dashboardTop3.length === 0 ? (
              <div style={{
                fontSize: t.bodySm.size, color: colors.text.disabled, textAlign: "center",
                padding: space[4], background: colors.bg.surface,
                border: `1px solid ${colors.border.default}`, borderRadius: radii.lg,
              }}>
                No quality items scored yet.
              </div>
            ) : (
              <div style={mobile
                ? { display: "flex", flexDirection: "column" as const, gap: space[4] }
                : { display: "grid", gridTemplateColumns: `repeat(3, minmax(0, 1fr))`, gap: space[4] }
              }>
                {dashboardTop3.map((bi, i) => {
                  const item = bi.item;
                  const gr = scoreGrade(item.scores.composite);
                  const tag = deriveScoreTags(item)[0] ?? null;
                  return (
                    <div key={item.id} style={{
                      animation: `slideUp .3s ease ${i * 0.08}s forwards`,
                      background: colors.bg.surface,
                      border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.lg,
                      overflow: "hidden",
                      transition: transitions.fast,
                    }}>
                      <ThumbnailArea item={item} gr={gr} gradeSize={48}
                        imgFailed={failedImages.has(item.id)} onImgError={() => markImgFailed(item.id)}
                        overlay={
                          <div style={{
                            position: "absolute", top: space[2], left: space[2],
                            width: 28, height: 28, borderRadius: "50%",
                            background: `linear-gradient(135deg, ${colors.blue[600]}, ${colors.purple[600]})`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: t.bodySm.size, fontWeight: 800, color: "#fff",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                          }}>{i + 1}</div>
                        }
                      />
                      <div style={{ padding: `${space[3]}px ${space[4]}px` }}>
                        {bi.classification !== "mixed" && (
                          <div style={{ marginBottom: space[1] }}>
                            <BriefingClassificationBadge classification={bi.classification} />
                          </div>
                        )}
                        <div style={{
                          fontSize: t.body.size, fontWeight: 700, color: colors.text.secondary,
                          overflow: "hidden", display: "-webkit-box",
                          WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const,
                          lineHeight: 1.4, marginBottom: space[2], wordBreak: "break-word" as const,
                        }}>
                          {item.text.slice(0, 200)}
                        </div>
                        <div style={{
                          fontSize: t.caption.size, color: colors.text.disabled,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          marginBottom: space[3],
                        }}>
                          {item.author} &middot; {item.platform || item.source} &middot; {item.timestamp}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                          <ScorePill gr={gr} tag={tag} />
                          <div style={{ flex: 1 }} />
                          <button onClick={(e) => { e.stopPropagation(); handleBookmark(item.id); }}
                            style={bookmarkSet.has(item.id) ? inlineBBtnActiveStyle : inlineBBtnStyle}>&#x1F516;</button>
                          <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(item.id); }}
                            disabled={item.validated} style={{ ...inlineVBtnStyle, opacity: item.validated ? 0.5 : 1, cursor: item.validated ? "default" : "pointer" }}>&#x2713;</button>
                          <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(item.id); }}
                            disabled={item.flagged} style={{ ...inlineFBtnStyle, opacity: item.flagged ? 0.5 : 1, cursor: item.flagged ? "default" : "pointer" }}>&#x2717;</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

            {/* Topic Spotlight */}
            <div style={{ marginBottom: space[4] }}>
              <div style={{
                fontSize: t.h3.size, fontWeight: t.h3.weight,
                color: colors.text.tertiary, marginBottom: space[3],
                display: "flex", alignItems: "center", gap: space[2],
              }}>
                <span>&#x1F3AF;</span> Topic Spotlight
              </div>
              {dashboardTopicSpotlight.length === 0 ? (
                <div style={{
                  fontSize: t.bodySm.size, color: colors.text.disabled, textAlign: "center",
                  padding: space[4], background: colors.bg.surface,
                  border: `1px solid ${colors.border.default}`, borderRadius: radii.lg,
                }}>
                  Validate more content to refine recommendations.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
                  {dashboardTopicSpotlight.map(({ topic, items }) => {
                    const isExpanded = expandedTopics.has(topic);
                    return (
                      <div key={topic} style={{
                        background: "transparent",
                        border: `1px solid ${colors.border.subtle}`,
                        borderRadius: radii.lg,
                        overflow: "hidden",
                      }}>
                        <button
                          onClick={() => toggleTopic(topic)}
                          style={{
                            width: "100%",
                            padding: `${space[3]}px ${space[4]}px`,
                            background: isExpanded ? colors.bg.surface : "transparent",
                            border: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: space[2],
                            fontFamily: "inherit",
                            transition: transitions.fast,
                          }}
                        >
                          <span style={{
                            fontSize: t.bodySm.size, fontWeight: 700,
                            padding: `2px ${space[2]}px`,
                            background: "rgba(6,182,212,0.1)",
                            borderRadius: radii.pill,
                            color: colors.cyan[400],
                          }}>
                            {topic}
                          </span>
                          <span style={{
                            fontSize: t.caption.size,
                            color: colors.text.muted,
                            background: colors.bg.raised,
                            padding: "2px 8px",
                            borderRadius: radii.sm,
                          }}>
                            {items.length}
                          </span>
                          <div style={{ flex: 1 }} />
                          <span style={{
                            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                            transition: transitions.fast,
                            fontSize: 12,
                            color: colors.text.muted,
                          }}>
                            ▼
                          </span>
                        </button>
                        {isExpanded && (
                          <div style={{
                            padding: `${space[3]}px ${space[4]}px`,
                            borderTop: `1px solid ${colors.border.subtle}`,
                            animation: "slideDown .2s ease forwards",
                          }}>
                            <div style={mobile
                              ? { display: "flex", flexDirection: "column" as const, gap: space[4] }
                              : { display: "grid", gridTemplateColumns: `repeat(3, minmax(0, 1fr))`, gap: space[4] }
                            }>
                              {items.map((item) => {
                                const gr = scoreGrade(item.scores.composite);
                                const tag = deriveScoreTags(item)[0] ?? null;
                                return (
                                  <div key={item.id} style={{
                                    background: colors.bg.surface,
                                    border: `1px solid ${colors.border.default}`,
                                    borderRadius: radii.lg,
                                    overflow: "hidden",
                                    transition: transitions.fast,
                                  }}>
                                    <ThumbnailArea item={item} gr={gr} gradeSize={36}
                                      imgFailed={failedImages.has(item.id)} onImgError={() => markImgFailed(item.id)}
                                    />
                                    <div style={{ padding: `${space[3]}px ${space[4]}px` }}>
                                      <div style={{
                                        fontSize: t.body.size, fontWeight: 600, color: colors.text.secondary,
                                        overflow: "hidden", display: "-webkit-box",
                                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                                        lineHeight: 1.4, marginBottom: space[2], wordBreak: "break-word" as const,
                                      }}>
                                        {item.text.slice(0, 150)}
                                      </div>
                                      <div style={{
                                        fontSize: t.caption.size, color: colors.text.disabled,
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        marginBottom: space[3],
                                      }}>
                                        {item.author} &middot; {item.source} &middot; {item.timestamp}
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                                        <ScorePill gr={gr} tag={tag} />
                                        <div style={{ flex: 1 }} />
                                        <button onClick={(e) => { e.stopPropagation(); handleBookmark(item.id); }}
                                          style={bookmarkSet.has(item.id) ? inlineBBtnActiveStyle : inlineBBtnStyle}>&#x1F516;</button>
                                        <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(item.id); }}
                                          disabled={item.validated} style={{ ...inlineVBtnStyle, opacity: item.validated ? 0.5 : 1 }}>&#x2713;</button>
                                        <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(item.id); }}
                                          disabled={item.flagged} style={{ ...inlineFBtnStyle, opacity: item.flagged ? 0.5 : 1 }}>&#x2717;</button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          {/* Discoveries - Collapsible */}
          {filteredDiscoveries.length > 0 && (
            <CollapsibleSection
              id="discoveries"
              title="Discoveries"
              icon="🔭"
              isExpanded={expandedSections.has('discoveries')}
              onToggle={toggleSection}
              itemCount={filteredDiscoveries.length}
              mobile={mobile}
            >
              <div style={mobile
                ? { display: "flex", flexDirection: "column" as const, gap: space[4] }
                : { display: "grid", gridTemplateColumns: `repeat(3, minmax(0, 1fr))`, gap: space[4] }
              }>
                {filteredDiscoveries.map(d => {
                  const item = d.item;
                  const gr = scoreGrade(item.scores.composite);
                  const tag = deriveScoreTags(item)[0] ?? null;
                  return (
                    <div key={item.id} style={{
                      background: colors.bg.surface,
                      border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.lg,
                      overflow: "hidden",
                      transition: transitions.fast,
                    }}>
                      <ThumbnailArea item={item} gr={gr} gradeSize={36}
                        imgFailed={failedImages.has(item.id)} onImgError={() => markImgFailed(item.id)}
                        overlay={d.reason && (
                          <div style={{ position: "absolute", bottom: space[2], left: space[2], right: space[2] }}>
                            <SerendipityBadge discoveryType={d.discoveryType} />
                          </div>
                        )}
                      />
                      <div style={{ padding: `${space[3]}px ${space[4]}px` }}>
                        <div style={{
                          fontSize: t.body.size, fontWeight: 600, color: colors.text.secondary,
                          overflow: "hidden", display: "-webkit-box",
                          WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                          lineHeight: 1.4, marginBottom: space[2], wordBreak: "break-word" as const,
                        }}>
                          {item.text.slice(0, 150)}
                        </div>
                        <div style={{
                          fontSize: t.caption.size, color: colors.text.disabled,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          marginBottom: space[3],
                        }}>
                          {item.author} &middot; {item.source} &middot; {item.timestamp}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                          <ScorePill gr={gr} tag={tag} />
                          <div style={{ flex: 1 }} />
                          <button onClick={(e) => { e.stopPropagation(); handleBookmark(item.id); }}
                            style={bookmarkSet.has(item.id) ? inlineBBtnActiveStyle : inlineBBtnStyle}>&#x1F516;</button>
                          <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(item.id); }}
                            disabled={item.validated} style={{ ...inlineVBtnStyle, opacity: item.validated ? 0.5 : 1 }}>&#x2713;</button>
                          <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(item.id); }}
                            disabled={item.flagged} style={{ ...inlineFBtnStyle, opacity: item.flagged ? 0.5 : 1 }}>&#x2717;</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* Needs Review - Collapsible */}
          {unreviewedQueue.length > 0 && (
            <div style={{ marginTop: space[4], marginBottom: space[4] }}>
            <CollapsibleSection
              id="review-queue"
              title="Needs Review"
              icon="📋"
              isExpanded={expandedSections.has('review-queue')}
              onToggle={toggleSection}
              itemCount={unreviewedQueue.length}
              mobile={mobile}
            >
              <div style={mobile
                ? { display: "flex", flexDirection: "column" as const, gap: space[4] }
                : { display: "grid", gridTemplateColumns: `repeat(3, minmax(0, 1fr))`, gap: space[4] }
              }>
                {unreviewedQueue.map(item => {
                  const gr = scoreGrade(item.scores.composite);
                  const tag = deriveScoreTags(item)[0] ?? null;
                  return (
                    <div key={item.id} style={{
                      background: colors.bg.surface,
                      border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.lg,
                      overflow: "hidden",
                      transition: transitions.fast,
                    }}>
                      <ThumbnailArea item={item} gr={gr} gradeSize={36}
                        imgFailed={failedImages.has(item.id)} onImgError={() => markImgFailed(item.id)}
                      />
                      <div style={{ padding: `${space[3]}px ${space[4]}px` }}>
                        <div style={{
                          fontSize: t.body.size, fontWeight: 600, color: colors.text.secondary,
                          overflow: "hidden", display: "-webkit-box",
                          WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                          lineHeight: 1.4, marginBottom: space[2], wordBreak: "break-word" as const,
                        }}>
                          {item.text.slice(0, 150)}
                        </div>
                        <div style={{
                          fontSize: t.caption.size, color: colors.text.disabled,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          marginBottom: space[3],
                        }}>
                          {item.author} &middot; {item.source} &middot; {item.timestamp}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                          <ScorePill gr={gr} tag={tag} />
                          <div style={{ flex: 1 }} />
                          <button onClick={(e) => { e.stopPropagation(); handleBookmark(item.id); }}
                            style={bookmarkSet.has(item.id) ? inlineBBtnActiveStyle : inlineBBtnStyle}>&#x1F516;</button>
                          <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(item.id); }}
                            disabled={item.validated} style={{ ...inlineVBtnStyle, opacity: item.validated ? 0.5 : 1 }}>&#x2713;</button>
                          <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(item.id); }}
                            disabled={item.flagged} style={{ ...inlineFBtnStyle, opacity: item.flagged ? 0.5 : 1 }}>&#x2717;</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
            </div>
          )}

          {/* Saved - Full width 3-card grid */}
          {dashboardSaved.length > 0 && (
            <div style={{ marginBottom: space[4] }}>
              <div style={{
                fontSize: t.h3.size, fontWeight: t.h3.weight,
                color: colors.text.tertiary, marginBottom: space[3],
                display: "flex", alignItems: "center", gap: space[2],
              }}>
                <span>🔖</span> Saved
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => { setVerdictFilter("bookmarked"); setHomeMode("feed"); }}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: colors.cyan[400], fontSize: t.caption.size, fontWeight: 600,
                    fontFamily: "inherit", padding: 0,
                  }}
                >
                  Review Saved &rarr;
                </button>
              </div>
              <div style={mobile
                ? { display: "flex", flexDirection: "column" as const, gap: space[4] }
                : { display: "grid", gridTemplateColumns: `repeat(3, minmax(0, 1fr))`, gap: space[4] }
              }>
                {dashboardSaved.map(item => {
                  const gr = scoreGrade(item.scores.composite);
                  const tag = deriveScoreTags(item)[0] ?? null;
                  return (
                    <div key={item.id} style={{
                      background: colors.bg.surface,
                      border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.lg,
                      overflow: "hidden",
                      transition: transitions.fast,
                    }}>
                      <ThumbnailArea item={item} gr={gr} gradeSize={36}
                        imgFailed={failedImages.has(item.id)} onImgError={() => markImgFailed(item.id)}
                      />
                      <div style={{ padding: `${space[3]}px ${space[4]}px` }}>
                        <div style={{
                          fontSize: t.body.size, fontWeight: 600, color: colors.text.secondary,
                          overflow: "hidden", display: "-webkit-box",
                          WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                          lineHeight: 1.4, marginBottom: space[2], wordBreak: "break-word" as const,
                        }}>
                          {item.text.slice(0, 150)}
                        </div>
                        <div style={{
                          fontSize: t.caption.size, color: colors.text.disabled,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          marginBottom: space[3],
                        }}>
                          {item.author} &middot; {item.source} &middot; {item.timestamp}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                          <ScorePill gr={gr} tag={tag} />
                          <div style={{ flex: 1 }} />
                          <button onClick={(e) => { e.stopPropagation(); handleBookmark(item.id); }}
                            style={bookmarkSet.has(item.id) ? inlineBBtnActiveStyle : inlineBBtnStyle}>&#x1F516;</button>
                          <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(item.id); }}
                            disabled={item.validated} style={{ ...inlineVBtnStyle, opacity: item.validated ? 0.5 : 1 }}>&#x2713;</button>
                          <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(item.id); }}
                            disabled={item.flagged} style={{ ...inlineFBtnStyle, opacity: item.flagged ? 0.5 : 1 }}>&#x2717;</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Agent Knowledge — full width */}
          {agentContext && (
            <div style={{
              padding: `${space[3]}px ${space[4]}px`,
              background: "transparent",
              border: `1px solid ${agentKnowsHighlight ? "rgba(139,92,246,0.3)" : colors.border.subtle}`,
              borderRadius: radii.lg,
              marginBottom: space[4],
              transition: "border-color 0.5s ease, box-shadow 0.5s ease",
              boxShadow: agentKnowsHighlight ? "0 0 12px rgba(139,92,246,0.1)" : "none",
            }}>
              <div style={{ fontSize: t.bodySm.size, fontWeight: 600, color: colors.text.tertiary, marginBottom: space[2], display: "flex", alignItems: "center", gap: space[2] }}>
                <span>&#x1F9E0;</span> Your Agent Knows
              </div>
              <AgentKnowledgePills agentContext={agentContext} profile={profile} />
            </div>
          )}

          {/* Agent Settings — summary card with link to Settings > Agent */}
          <div style={{
            background: colors.bg.surface,
            border: `1px solid ${colors.border.default}`,
            borderRadius: radii.lg,
            padding: `${space[3]}px ${space[4]}px`,
            marginBottom: space[4],
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: space[2], width: "100%",
            }}>
              <GearIcon s={16} />
              <span style={{ color: colors.text.tertiary, fontSize: t.bodySm.size, fontWeight: 600 }}>Agent Settings</span>
              <span style={{ color: colors.text.disabled, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, fontSize: t.bodySm.size }}>
                : {Object.entries(profile.topicAffinities).filter(([, v]) => v >= 0.2).length} interests
                &middot; threshold {profile.calibration.qualityThreshold.toFixed(1)}
                &middot; {profile.totalValidated + profile.totalFlagged} reviews
              </span>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => onTabChange?.("settings:agent")}
                style={{
                  padding: `${space[1]}px ${space[3]}px`,
                  background: `${colors.cyan[400]}10`,
                  border: `1px solid ${colors.cyan[400]}25`,
                  borderRadius: radii.md,
                  color: colors.cyan[400],
                  fontSize: t.caption.size, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                  transition: transitions.fast,
                  whiteSpace: "nowrap", flexShrink: 0,
                }}
              >
                Edit
              </button>
            </div>
          </div>

        </div>
      )}

      {/* Keyboard shortcut hint — only in feed mode where keyboard nav is active */}
      {!mobile && homeMode === "feed" && (
        <div style={{
          textAlign: "center", marginTop: space[3],
          fontSize: t.tiny.size, color: colors.text.disabled,
        }}>
          <span style={{ fontFamily: fonts.mono }}>J/K</span> navigate &middot; <span style={{ fontFamily: fonts.mono }}>V</span> validate &middot; <span style={{ fontFamily: fonts.mono }}>F</span> flag &middot; <span style={{ fontFamily: fonts.mono }}>{navigator?.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+K</span> commands
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} mobile={mobile} />
    </div>
  );
};

