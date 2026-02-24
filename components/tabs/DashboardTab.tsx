"use client";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard, deriveScoreTags } from "@/components/ui/ContentCard";
import { ChevronDownIcon, GearIcon } from "@/components/icons";
import { fonts, colors, space, type as t, radii, transitions, scoreGrade } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import { contentToCSV } from "@/lib/utils/csv";
import { extractYouTubeVideoId, youTubeEmbedUrl } from "@/lib/utils/youtube";
import { useFilterMode } from "@/contexts/FilterModeContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { getContext, hasEnoughData } from "@/lib/preferences/engine";
import { D2ANetworkMini } from "@/components/ui/D2ANetworkMini";
import {
  applyDashboardFilters,
  computeDashboardTop3,
  computeTopicSpotlight,
  computeDashboardActivity,
  computeDashboardValidated,
  computeUnreviewedQueue,
  computeTopicDistribution,
} from "@/lib/dashboard/utils";
import { SerendipityBadge } from "@/components/filtering/SerendipityBadge";
import type { SerendipityItem } from "@/lib/filtering/serendipity";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import { CommandPalette } from "@/components/ui/CommandPalette";
import type { PaletteCommand } from "@/components/ui/CommandPalette";

function downloadFile(data: string, filename: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
        <img src={item.imageUrl!} alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          onError={onImgError} />
      ) : (
        <>
          <span style={{ fontSize: gradeSize, fontWeight: 800, color: gr.color, fontFamily: fonts.mono }}>{gr.grade}</span>
          <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>{item.source}</span>
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

interface DashboardTabProps {
  content: ContentItem[];
  mobile?: boolean;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  isLoading?: boolean;
  wotLoading?: boolean;
  onTabChange?: (tab: string) => void;
  discoveries?: SerendipityItem[];
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ content, mobile, onValidate, onFlag, isLoading, wotLoading, onTabChange, discoveries = [] }) => {
  const { filterMode } = useFilterMode();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<"all" | "quality" | "slop" | "validated">("quality");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAllContent, setShowAllContent] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const markImgFailed = useCallback((id: string) => {
    setFailedImages(prev => { const next = new Set(prev); next.add(id); return next; });
  }, []);
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
  const { profile, setTopicAffinity, removeTopicAffinity, setQualityThreshold } = usePreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activityRange, setActivityRange] = useState<"today" | "7d" | "30d">("today");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newTopic, setNewTopic] = useState("");

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
  }, [verdictFilter, sourceFilter]);

  const filteredContent = useMemo(
    () => applyDashboardFilters(content, verdictFilter, sourceFilter),
    [content, verdictFilter, sourceFilter],
  );

  const hasActiveFilter = verdictFilter !== "all" || sourceFilter !== "all";

  const agentContext = useMemo(() => {
    if (!hasEnoughData(profile)) return null;
    return getContext(profile);
  }, [profile]);

  // Dashboard computations: cached by profile only.
  // Feed↔Dashboard toggle shows/hides cached results — no recalculation.
  const contentRef = useRef(content);
  contentRef.current = content;
  const briefingNowRef = useRef(Date.now());
  useEffect(() => { briefingNowRef.current = Date.now(); }, [profile]);

  const dashboardTop3 = useMemo(() => {
    return computeDashboardTop3(contentRef.current, profile, briefingNowRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const dashboardTopicSpotlight = useMemo(() => {
    return computeTopicSpotlight(contentRef.current, profile, dashboardTop3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, dashboardTop3]);

  // Cascading cross-section deduplication: Top3 → Spotlight → Discoveries → Unreviewed → Validated
  // Consolidated into a single memo to avoid 6-step intermediate Set allocations.
  const { filteredDiscoveries, unreviewedQueue, dashboardValidated } = useMemo(() => {
    // 1. Top sections: Top3 + Spotlight
    const topIds = new Set(dashboardTop3.map(c => c.item.id));
    for (const group of dashboardTopicSpotlight) {
      for (const item of group.items) topIds.add(item.id);
    }

    // 2. Discoveries (exclude items already in top sections)
    const filtDisc = discoveries.filter(d => !topIds.has(d.item.id));
    for (const d of filtDisc) topIds.add(d.item.id);

    // 3. Unreviewed queue (exclude all shown so far)
    const queue = computeUnreviewedQueue(contentRef.current, topIds);
    for (const item of queue) topIds.add(item.id);

    // 4. Validated (exclude everything above)
    const validated = computeDashboardValidated(contentRef.current, topIds);

    return { filteredDiscoveries: filtDisc, unreviewedQueue: queue, dashboardValidated: validated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardTop3, dashboardTopicSpotlight, discoveries]);

  const topicDistribution = useMemo(() => {
    if (homeMode !== "dashboard") return null;
    return computeTopicDistribution(content);
  }, [content, homeMode]);

  const dashboardActivity = useMemo(() => {
    if (homeMode !== "dashboard") return null;
    return computeDashboardActivity(content, activityRange);
  }, [content, homeMode, activityRange]);

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
    const item = content.find(c => c.id === id);
    onValidate(id);
    if (item) {
      const parts: string[] = [];
      const topic = item.topics?.[0];
      if (topic) parts.push(`[${topic}] \u2191`);
      if (item.author && item.author !== "You") parts.push(`Trust in ${item.author} \u2191`);
      if (item.scores.composite >= 3.5 && item.scores.composite <= 4.5) parts.push("Threshold relaxed");
      if (parts.length > 0) showFeedback(parts.join("  \u00B7  "));
    }
  }, [content, onValidate, showFeedback]);

  const handleFlagWithFeedback = useCallback((id: string) => {
    const item = content.find(c => c.id === id);
    onFlag(id);
    if (item) {
      const parts: string[] = [];
      const topic = item.topics?.[0];
      if (topic) parts.push(`[${topic}] \u2193`);
      if (item.author && item.author !== "You") parts.push(`${item.author} trust \u2193`);
      if (item.verdict === "quality") parts.push("Threshold tightened");
      if (parts.length > 0) showFeedback(parts.join("  \u00B7  "));
    }
  }, [content, onFlag, showFeedback]);

  useEffect(() => {
    return () => { clearTimeout(feedbackTimerRef.current); };
  }, []);

  const feedItemIds = useMemo(() => filteredContent.slice(0, showAllContent ? 50 : 5).map(c => c.id), [filteredContent, showAllContent]);

  const { focusedId } = useKeyboardNav({
    items: feedItemIds,
    expandedId: expanded,
    onExpand: setExpanded,
    onValidate: handleValidateWithFeedback,
    onFlag: handleFlagWithFeedback,
    onOpenPalette: () => setPaletteOpen(true),
    enabled: !mobile && homeMode === "feed",
  });

  const exportCSV = useCallback(() => {
    downloadFile(contentToCSV(content), `aegis-evaluations-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
  }, [content]);

  const exportJSON = useCallback(() => {
    const data = content.map(c => ({
      id: c.id, author: c.author, source: c.source, verdict: c.verdict,
      scores: c.scores, vSignal: c.vSignal, cContext: c.cContext, lSlop: c.lSlop,
      topics: c.topics, text: c.text, reason: c.reason,
      createdAt: new Date(c.createdAt).toISOString(),
      validatedAt: c.validatedAt ? new Date(c.validatedAt).toISOString() : null,
      sourceUrl: c.sourceUrl,
    }));
    downloadFile(JSON.stringify(data, null, 2), `aegis-evaluations-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
  }, [content]);

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
    { label: "Export CSV", action: exportCSV },
    { label: "Export JSON", action: exportJSON },
  ], [onTabChange, exportCSV, exportJSON]);

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
            onClick={() => onTabChange?.("settings")}
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
            title="Change in Settings"
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
              Filtered Signal {hasActiveFilter && <span style={{ fontSize: t.bodySm.size, color: colors.text.disabled }}>({filteredContent.length})</span>}
            </div>
            <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
              {(["quality", "all", "slop", "validated"] as const).map(v => (
                <button
                  key={v}
                  data-testid={`aegis-filter-${v}`}
                  onClick={() => setVerdictFilter(v)}
                  style={{
                    padding: `${space[1]}px ${space[3]}px`,
                    background: verdictFilter === v
                      ? (v === "quality" ? colors.green.bg : v === "slop" ? colors.red.bg : v === "validated" ? "rgba(167,139,250,0.06)" : colors.bg.raised)
                      : "transparent",
                    border: `1px solid ${verdictFilter === v
                      ? (v === "quality" ? colors.green.border : v === "slop" ? colors.red.border : v === "validated" ? "rgba(167,139,250,0.15)" : colors.border.emphasis)
                      : colors.border.default}`,
                    borderRadius: radii.pill,
                    color: verdictFilter === v
                      ? (v === "quality" ? colors.green[400] : v === "slop" ? colors.red[400] : v === "validated" ? colors.purple[400] : colors.text.secondary)
                      : colors.text.disabled,
                    fontSize: t.caption.size,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: transitions.fast,
                    textTransform: "capitalize",
                  }}
                >
                  {v === "validated" ? `\u2713 ${v}` : v}
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
            <div style={{
              textAlign: "center", padding: space[10],
              color: colors.text.muted, background: colors.bg.surface,
              borderRadius: radii.lg, border: `1px solid ${colors.border.default}`,
              marginBottom: space[4],
            }}>
              <div style={{ fontSize: 32, marginBottom: space[3] }}>&#x1F50D;</div>
              <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>
                {hasActiveFilter ? "No matching content" : "No content yet"}
              </div>
              <div style={{ fontSize: t.bodySm.size, marginTop: space[2] }}>
                {hasActiveFilter ? "Try adjusting your filters" : "Add sources to start filtering, or try the incinerator for manual evaluation"}
              </div>
              {!hasActiveFilter && onTabChange && (
                <div style={{ display: "flex", gap: space[2], justifyContent: "center", marginTop: space[4], flexWrap: "wrap" }}>
                  <button onClick={() => onTabChange("sources")} style={{
                    padding: `${space[2]}px ${space[4]}px`, background: colors.bg.raised,
                    border: `1px solid ${colors.border.emphasis}`, borderRadius: radii.md,
                    color: colors.blue[400], fontSize: t.bodySm.size, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit", transition: transitions.fast,
                  }}>
                    Add Sources &rarr;
                  </button>
                  <button onClick={() => onTabChange("incinerator")} style={{
                    padding: `${space[2]}px ${space[4]}px`, background: colors.bg.raised,
                    border: `1px solid ${colors.border.emphasis}`, borderRadius: radii.md,
                    color: colors.purple[400], fontSize: t.bodySm.size, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit", transition: transitions.fast,
                  }}>
                    Try Incinerator &rarr;
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {filteredContent.slice(0, showAllContent ? 50 : 5).map((it, i) => (
                <div key={it.id} style={{ animation: `slideUp .2s ease ${i * 0.03}s both` }}>
                  {verdictFilter === "validated" && it.validatedAt && (
                    <div style={{
                      fontSize: t.caption.size, color: colors.purple[400],
                      marginBottom: space[1], marginLeft: space[1],
                      fontFamily: fonts.mono, fontWeight: 600,
                    }}>
                      Validated {new Date(it.validatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      {" "}
                      {new Date(it.validatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                  <ContentCard
                    item={it}
                    expanded={expanded === it.id}
                    onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
                    onValidate={handleValidateWithFeedback}
                    onFlag={handleFlagWithFeedback}
                    mobile={mobile}
                    focused={focusedId === it.id}
                  />
                </div>
              ))}
              {filteredContent.length > 5 && !showAllContent && (
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
                  Show all ({filteredContent.length} items)
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
          <div style={{
            display: "grid",
            gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
            gap: space[4],
            marginBottom: space[4],
          }}>
          {/* Today's Top 3 — full width */}
          <div data-testid="aegis-top3-section" style={{ gridColumn: mobile ? undefined : "1 / -1" }}>
            <div style={{
              fontSize: t.h3.size, fontWeight: t.h3.weight,
              color: colors.text.tertiary, marginBottom: space[3],
              display: "flex", alignItems: "center", gap: space[2],
            }}>
              <span>&#x2B50;</span> Today&#39;s Top 3
              <div style={{ flex: 1 }} />
              <button
                onClick={() => { setHomeMode("feed"); setVerdictFilter("all"); }}
                style={{
                  fontSize: t.caption.size, fontWeight: 600,
                  color: colors.cyan[400], background: "transparent",
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Review All &rarr;
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
                : { display: "grid", gridTemplateColumns: `repeat(${Math.min(dashboardTop3.length, 3)}, minmax(0, 1fr))`, gap: space[4] }
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
                          {item.author} &middot; {item.source} &middot; {item.timestamp}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                          <ScorePill gr={gr} tag={tag} />
                          <div style={{ flex: 1 }} />
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
            <div style={{
              background: "transparent",
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: radii.lg,
              padding: `${space[3]}px ${space[4]}px`,
            }}>
              <div style={{
                fontSize: t.bodySm.size, fontWeight: 600,
                color: colors.text.tertiary, marginBottom: space[3],
                display: "flex", alignItems: "center", gap: space[2],
              }}>
                <span>&#x1F3AF;</span> Topic Spotlight
              </div>
              {dashboardTopicSpotlight.length === 0 ? (
                <div style={{ fontSize: t.bodySm.size, color: colors.text.disabled, textAlign: "center", padding: space[4] }}>
                  Validate more content to refine recommendations.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
                  {dashboardTopicSpotlight.map(({ topic, items }) => {
                    const [heroItem, ...runnerUps] = items;
                    const heroGr = scoreGrade(heroItem.scores.composite);
                    const heroTag = deriveScoreTags(heroItem)[0] ?? null;
                    return (
                      <div key={topic} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                        <div style={{
                          background: colors.bg.surface,
                          border: `1px solid ${colors.border.default}`,
                          borderRadius: runnerUps.length > 0
                            ? `${typeof radii.lg === "number" ? radii.lg : 12}px ${typeof radii.lg === "number" ? radii.lg : 12}px 0 0`
                            : radii.lg,
                          overflow: "hidden",
                          transition: transitions.fast,
                        }}>
                          <ThumbnailArea item={heroItem} gr={heroGr} gradeSize={36}
                            imgFailed={failedImages.has(heroItem.id)} onImgError={() => markImgFailed(heroItem.id)}
                            overlay={
                              <div style={{
                                position: "absolute", top: space[2], left: space[2],
                                padding: `2px ${space[2]}px`,
                                background: "rgba(6,182,212,0.85)",
                                borderRadius: radii.pill,
                                fontSize: t.caption.size, fontWeight: 700, color: "#fff",
                                backdropFilter: "blur(4px)",
                              }}>{topic}</div>
                            }
                          />
                          <div style={{ padding: `${space[3]}px ${space[4]}px` }}>
                            <div style={{
                              fontSize: t.body.size, fontWeight: 700, color: colors.text.secondary,
                              overflow: "hidden", display: "-webkit-box",
                              WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                              lineHeight: 1.4, marginBottom: space[2], wordBreak: "break-word" as const,
                            }}>
                              {heroItem.text.slice(0, 200)}
                            </div>
                            <div style={{
                              fontSize: t.caption.size, color: colors.text.disabled,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              marginBottom: space[3],
                            }}>
                              {heroItem.author} &middot; {heroItem.source} &middot; {heroItem.timestamp}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                              <ScorePill gr={heroGr} tag={heroTag} />
                              <div style={{ flex: 1 }} />
                              <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(heroItem.id); }}
                                disabled={heroItem.validated} style={{ ...inlineVBtnStyle, opacity: heroItem.validated ? 0.5 : 1, cursor: heroItem.validated ? "default" : "pointer" }}>&#x2713;</button>
                              <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(heroItem.id); }}
                                disabled={heroItem.flagged} style={{ ...inlineFBtnStyle, opacity: heroItem.flagged ? 0.5 : 1, cursor: heroItem.flagged ? "default" : "pointer" }}>&#x2717;</button>
                            </div>
                          </div>
                        </div>
                        {runnerUps.map((ruItem, ruIdx) => {
                          const ruGr = scoreGrade(ruItem.scores.composite);
                          const ruTag = deriveScoreTags(ruItem)[0] ?? null;
                          const showThumb = ruItem.imageUrl && !failedImages.has(ruItem.id);
                          const ruHasLink = ruItem.sourceUrl && /^https?:\/\//i.test(ruItem.sourceUrl);
                          const isLast = ruIdx === runnerUps.length - 1;
                          const ruThumbContent = (
                            <div style={{
                              width: 80, minHeight: 60, flexShrink: 0,
                              overflow: "hidden",
                              background: showThumb ? colors.bg.raised : `linear-gradient(135deg, ${ruGr.bg}, ${colors.bg.raised})`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              flexDirection: "column", gap: 2,
                              cursor: ruHasLink ? "pointer" : undefined,
                            }}>
                              {showThumb ? (
                                /* eslint-disable-next-line @next/next/no-img-element -- spotlight compact thumbnail */
                                <img src={ruItem.imageUrl!} alt=""
                                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                  onError={() => markImgFailed(ruItem.id)} />
                              ) : (
                                <span style={{ fontSize: 20, fontWeight: 800, color: ruGr.color, fontFamily: fonts.mono }}>{ruGr.grade}</span>
                              )}
                            </div>
                          );
                          return (
                            <div key={ruItem.id} style={{
                              background: colors.bg.surface,
                              borderLeft: `1px solid ${colors.border.default}`,
                              borderRight: `1px solid ${colors.border.default}`,
                              borderBottom: `1px solid ${colors.border.default}`,
                              borderTop: "none",
                              borderRadius: isLast
                                ? `0 0 ${typeof radii.lg === "number" ? radii.lg : 12}px ${typeof radii.lg === "number" ? radii.lg : 12}px`
                                : undefined,
                              overflow: "hidden",
                              transition: transitions.fast,
                            }}>
                              <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                                {ruHasLink ? (
                                  <a href={ruItem.sourceUrl!} target="_blank" rel="noopener noreferrer" style={{ display: "flex", flexShrink: 0 }}>
                                    {ruThumbContent}
                                  </a>
                                ) : ruThumbContent}
                                <div style={{ flex: 1, minWidth: 0, padding: `${space[3]}px ${space[4]}px` }}>
                                  <div style={{
                                    fontSize: t.body.size, fontWeight: 600, color: colors.text.secondary,
                                    overflow: "hidden", display: "-webkit-box",
                                    WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                                    lineHeight: 1.4, marginBottom: space[1], wordBreak: "break-word" as const,
                                  }}>
                                    {ruItem.text.slice(0, 160)}
                                  </div>
                                  <div style={{
                                    fontSize: t.caption.size, color: colors.text.disabled,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    marginBottom: space[2],
                                  }}>
                                    {ruItem.author} &middot; {ruItem.source}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                                    <ScorePill gr={ruGr} tag={ruTag} />
                                    <div style={{ flex: 1 }} />
                                    <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(ruItem.id); }}
                                      disabled={ruItem.validated} style={{ ...inlineVBtnStyle, opacity: ruItem.validated ? 0.5 : 1, cursor: ruItem.validated ? "default" : "pointer" }}>&#x2713;</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(ruItem.id); }}
                                      disabled={ruItem.flagged} style={{ ...inlineFBtnStyle, opacity: ruItem.flagged ? 0.5 : 1, cursor: ruItem.flagged ? "default" : "pointer" }}>&#x2717;</button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          {/* Right column: Discoveries + Validated */}
          <div style={{ display: "flex", flexDirection: "column", gap: `${space[4]}px` }}>

          {/* Discoveries */}
          {filteredDiscoveries.length > 0 && (
            <div style={{
              background: "transparent",
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: radii.lg,
              padding: `${space[3]}px ${space[4]}px`,
            }}>
              <div style={{
                fontSize: t.bodySm.size, fontWeight: 600,
                color: colors.text.tertiary, marginBottom: space[3],
                display: "flex", alignItems: "center", gap: space[2],
              }}>
                <span>&#x1F52D;</span> Discoveries
                <span style={{
                  fontSize: t.caption.size, color: colors.text.muted,
                  background: colors.bg.raised, padding: "2px 8px", borderRadius: radii.sm,
                }}>{filteredDiscoveries.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
                {filteredDiscoveries.map(d => {
                  const item = d.item;
                  const gr = scoreGrade(item.scores.composite);
                  const tag = deriveScoreTags(item)[0] ?? null;
                  const showThumb = item.imageUrl && !failedImages.has(item.id);
                  const dHasLink = item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl);
                  const dThumbContent = (
                    <div style={{
                      width: 80, minHeight: 60, flexShrink: 0,
                      overflow: "hidden",
                      background: showThumb ? colors.bg.raised : `linear-gradient(135deg, ${gr.bg}, ${colors.bg.raised})`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexDirection: "column", gap: 2,
                      cursor: dHasLink ? "pointer" : undefined,
                    }}>
                      {showThumb ? (
                        /* eslint-disable-next-line @next/next/no-img-element -- discovery card thumbnail */
                        <img src={item.imageUrl!} alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          onError={() => markImgFailed(item.id)} />
                      ) : (
                        <span style={{ fontSize: 20, fontWeight: 800, color: gr.color, fontFamily: fonts.mono }}>{gr.grade}</span>
                      )}
                    </div>
                  );
                  return (
                    <div key={item.id} style={{
                      background: colors.bg.surface,
                      border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.md,
                      overflow: "hidden", transition: transitions.fast,
                    }}>
                      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                        {dHasLink ? (
                          <a href={item.sourceUrl!} target="_blank" rel="noopener noreferrer" style={{ display: "flex", flexShrink: 0 }}>
                            {dThumbContent}
                          </a>
                        ) : dThumbContent}
                        <div style={{ flex: 1, minWidth: 0, padding: `${space[3]}px ${space[4]}px` }}>
                          <div style={{ marginBottom: space[1] }}>
                            <SerendipityBadge discoveryType={d.discoveryType} mobile={mobile} />
                          </div>
                          <div style={{
                            fontSize: t.body.size, fontWeight: 600, color: colors.text.secondary,
                            overflow: "hidden", display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                            lineHeight: 1.4, marginBottom: space[1], wordBreak: "break-word" as const,
                          }}>
                            {item.text.slice(0, 160)}
                          </div>
                          <div style={{
                            fontSize: t.caption.size, color: colors.text.disabled,
                            fontStyle: "italic", marginBottom: space[2],
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {d.reason}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                            <ScorePill gr={gr} tag={tag} />
                            <div style={{ flex: 1 }} />
                            <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(item.id); }}
                              disabled={item.validated} style={{ ...inlineVBtnStyle, opacity: item.validated ? 0.5 : 1, cursor: item.validated ? "default" : "pointer" }}>&#x2713;</button>
                            <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(item.id); }}
                              disabled={item.flagged} style={{ ...inlineFBtnStyle, opacity: item.flagged ? 0.5 : 1, cursor: item.flagged ? "default" : "pointer" }}>&#x2717;</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Unreviewed Queue */}
          <div style={{
            background: "transparent",
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: radii.lg,
            padding: `${space[3]}px ${space[4]}px`,
          }}>
            <div style={{
              fontSize: t.bodySm.size, fontWeight: 600,
              color: colors.text.tertiary, marginBottom: space[3],
              display: "flex", alignItems: "center", gap: space[2],
            }}>
              <span>&#x1F4CB;</span> Needs Review
              {unreviewedQueue.length > 0 && (
                <span style={{
                  fontSize: t.caption.size, color: colors.text.muted,
                  background: colors.bg.raised, padding: "2px 8px", borderRadius: radii.sm,
                }}>{unreviewedQueue.length}</span>
              )}
            </div>
            {unreviewedQueue.length === 0 ? (
              <div style={{ fontSize: t.bodySm.size, color: colors.text.disabled, textAlign: "center", padding: space[4] }}>
                All caught up! No items need review.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
                {unreviewedQueue.map(item => {
                  const gr = scoreGrade(item.scores.composite);
                  const tag = deriveScoreTags(item)[0] ?? null;
                  const showThumb = item.imageUrl && !failedImages.has(item.id);
                  const hasLink = item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl);
                  const thumbContent = (
                    <div style={{
                      width: 80, minHeight: 60, flexShrink: 0,
                      overflow: "hidden",
                      background: showThumb ? colors.bg.raised : `linear-gradient(135deg, ${gr.bg}, ${colors.bg.raised})`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexDirection: "column", gap: 2,
                      cursor: hasLink ? "pointer" : undefined,
                    }}>
                      {showThumb ? (
                        /* eslint-disable-next-line @next/next/no-img-element -- unreviewed card thumbnail */
                        <img src={item.imageUrl!} alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          onError={() => markImgFailed(item.id)} />
                      ) : (
                        <span style={{ fontSize: 20, fontWeight: 800, color: gr.color, fontFamily: fonts.mono }}>{gr.grade}</span>
                      )}
                    </div>
                  );
                  return (
                    <div key={item.id} style={{
                      background: colors.bg.surface,
                      border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.md,
                      overflow: "hidden", transition: transitions.fast,
                    }}>
                      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                        {hasLink ? (
                          <a href={item.sourceUrl!} target="_blank" rel="noopener noreferrer" style={{ display: "flex", flexShrink: 0 }}>
                            {thumbContent}
                          </a>
                        ) : thumbContent}
                        <div style={{ flex: 1, minWidth: 0, padding: `${space[2]}px ${space[3]}px` }}>
                          <div style={{
                            fontSize: t.bodySm.size, fontWeight: 600, color: colors.text.secondary,
                            overflow: "hidden", display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                            lineHeight: 1.4, marginBottom: space[1], wordBreak: "break-word" as const,
                          }}>
                            {item.text.slice(0, 120)}
                          </div>
                          <div style={{
                            fontSize: t.caption.size, color: colors.text.disabled,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            marginBottom: space[2],
                          }}>
                            {item.author} &middot; {item.source}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                            <ScorePill gr={gr} tag={tag} />
                            <div style={{ flex: 1 }} />
                            <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(item.id); }}
                              disabled={item.validated} style={{ ...inlineVBtnStyle, opacity: item.validated ? 0.5 : 1, cursor: item.validated ? "default" : "pointer" }}>&#x2713;</button>
                            <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(item.id); }}
                              disabled={item.flagged} style={{ ...inlineFBtnStyle, opacity: item.flagged ? 0.5 : 1, cursor: item.flagged ? "default" : "pointer" }}>&#x2717;</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, textAlign: "center" }}>
                  Review to teach your agent
                </div>
              </div>
            )}
          </div>

          {/* Validated */}
          <div style={{
            background: "transparent",
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: radii.lg,
            padding: `${space[3]}px ${space[4]}px`,
          }}>
            <div style={{
              fontSize: t.bodySm.size, fontWeight: 600,
              color: colors.text.tertiary, marginBottom: space[3],
              display: "flex", alignItems: "center", gap: space[2],
            }}>
              <span>&#x2713;</span> Validated
            </div>
            {dashboardValidated.length === 0 ? (
              <div style={{ fontSize: t.bodySm.size, color: colors.text.disabled, textAlign: "center", padding: space[4] }}>
                No validated items yet. Validate quality content to save it here.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
                {dashboardValidated.map(item => {
                  const gr = scoreGrade(item.scores.composite);
                  const tag = deriveScoreTags(item)[0] ?? null;
                  const showThumb = item.imageUrl && !failedImages.has(item.id);
                  const vHasLink = item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl);
                  const vThumbContent = (
                    <div style={{
                      width: 80, minHeight: 60, flexShrink: 0,
                      overflow: "hidden",
                      background: showThumb ? colors.bg.raised : `linear-gradient(135deg, ${gr.bg}, ${colors.bg.raised})`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexDirection: "column", gap: 2,
                      cursor: vHasLink ? "pointer" : undefined,
                    }}>
                      {showThumb ? (
                        /* eslint-disable-next-line @next/next/no-img-element -- validated card thumbnail */
                        <img src={item.imageUrl!} alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          onError={() => markImgFailed(item.id)} />
                      ) : (
                        <span style={{ fontSize: 20, fontWeight: 800, color: gr.color, fontFamily: fonts.mono }}>{gr.grade}</span>
                      )}
                    </div>
                  );
                  return (
                    <div key={item.id} style={{
                      background: colors.bg.surface,
                      border: `1px solid ${colors.border.default}`,
                      borderRadius: radii.md,
                      overflow: "hidden", transition: transitions.fast,
                    }}>
                      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                        {vHasLink ? (
                          <a href={item.sourceUrl!} target="_blank" rel="noopener noreferrer" style={{ display: "flex", flexShrink: 0 }}>
                            {vThumbContent}
                          </a>
                        ) : vThumbContent}
                        <div style={{ flex: 1, minWidth: 0, padding: `${space[3]}px ${space[4]}px` }}>
                          <div style={{
                            fontSize: t.body.size, fontWeight: 600, color: colors.text.secondary,
                            overflow: "hidden", display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                            lineHeight: 1.4, marginBottom: space[1], wordBreak: "break-word" as const,
                          }}>
                            {item.text.slice(0, 160)}
                          </div>
                          <div style={{
                            fontSize: t.caption.size, color: colors.text.disabled,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            marginBottom: space[2],
                          }}>
                            {item.author} &middot; {item.source}
                            {item.validatedAt && (
                              <> &middot; {new Date(item.validatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                            <ScorePill gr={gr} tag={tag} />
                            <div style={{ flex: 1 }} />
                            <button onClick={(e) => { e.stopPropagation(); handleValidateWithFeedback(item.id); }}
                              disabled={item.validated} style={{ ...inlineVBtnStyle, opacity: item.validated ? 0.5 : 1, cursor: item.validated ? "default" : "pointer" }}>&#x2713;</button>
                            <button onClick={(e) => { e.stopPropagation(); handleFlagWithFeedback(item.id); }}
                              disabled={item.flagged} style={{ ...inlineFBtnStyle, opacity: item.flagged ? 0.5 : 1, cursor: item.flagged ? "default" : "pointer" }}>&#x2717;</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* Topic Distribution */}
          <div style={{
            background: "transparent",
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: radii.lg,
            padding: `${space[3]}px ${space[4]}px`,
          }}>
            <div style={{
              fontSize: t.bodySm.size, fontWeight: 600,
              color: colors.text.tertiary, marginBottom: space[3],
              display: "flex", alignItems: "center", gap: space[2],
            }}>
              <span>&#x1F4CA;</span> Topic Breakdown
            </div>
            {(topicDistribution ?? []).length === 0 ? (
              <div style={{ fontSize: t.bodySm.size, color: colors.text.disabled, textAlign: "center", padding: space[4] }}>
                Add sources to see topic distribution.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
                {(topicDistribution ?? []).map(entry => {
                  const maxCount = (topicDistribution ?? [])[0]?.count ?? 0;
                  const barWidth = maxCount > 0 ? Math.max((entry.count / maxCount) * 100, 8) : 0;
                  const barColor = entry.qualityRate >= 0.6 ? colors.cyan[400] : entry.qualityRate >= 0.3 ? colors.sky[400] : colors.orange[400];
                  return (
                    <div key={entry.topic} style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                      <span style={{
                        width: 72, fontSize: t.caption.size, color: colors.text.muted,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        flexShrink: 0, textAlign: "right",
                      }}>
                        {entry.topic}
                      </span>
                      <div style={{ flex: 1, height: 14, background: colors.bg.raised, borderRadius: radii.sm, overflow: "hidden" }}>
                        <div style={{
                          width: `${barWidth}%`, height: "100%",
                          background: `${barColor}40`, borderRadius: radii.sm,
                          transition: "width 0.3s ease",
                        }} />
                      </div>
                      <span style={{
                        width: 28, fontSize: t.caption.size, color: colors.text.disabled,
                        fontFamily: fonts.mono, textAlign: "right", flexShrink: 0,
                      }}>
                        {entry.count}
                      </span>
                    </div>
                  );
                })}
                <div style={{
                  fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[1],
                  display: "flex", gap: space[3],
                }}>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: `${colors.cyan[400]}40`, marginRight: 4 }} />high quality</span>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: `${colors.orange[400]}40`, marginRight: 4 }} />mixed</span>
                </div>
              </div>
            )}
          </div>

          </div>{/* end right column */}
          </div>{/* end 2-col grid */}

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

          {/* === Inline Agent Settings === */}
          <div style={{
            background: colors.bg.surface,
            border: `1px solid ${colors.border.default}`,
            borderRadius: radii.lg,
            padding: `${space[3]}px ${space[4]}px`,
            marginBottom: space[4],
          }}>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              style={{
                display: "flex", alignItems: "center", gap: space[2], width: "100%",
                background: "transparent", border: "none", cursor: "pointer",
                color: colors.text.tertiary, fontSize: t.bodySm.size, fontWeight: 600,
                fontFamily: "inherit", padding: 0,
              }}
            >
              <GearIcon s={16} />
              <span>Agent Settings</span>
              {!settingsOpen && (
                <span style={{ color: colors.text.disabled, fontWeight: 400 }}>
                  : {Object.entries(profile.topicAffinities).filter(([, v]) => v >= 0.2).length} interests
                  &middot; threshold {profile.calibration.qualityThreshold.toFixed(1)}
                  &middot; {profile.totalValidated + profile.totalFlagged} reviews
                </span>
              )}
              <div style={{ flex: 1 }} />
              <span style={{
                display: "inline-flex",
                transform: settingsOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}>
                <ChevronDownIcon s={14} />
              </span>
            </button>

            {settingsOpen && (
              <div style={{ marginTop: space[3], paddingTop: space[3], borderTop: `1px solid ${colors.border.default}` }}>
                {/* Interest tag chips */}
                <div style={{ marginBottom: space[4] }}>
                  <div style={{ fontSize: t.caption.size, color: colors.text.disabled, marginBottom: space[2], fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Interests
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center" }}>
                    {Object.entries(profile.topicAffinities)
                      .filter(([, v]) => v >= 0.2)
                      .sort(([, a], [, b]) => b - a)
                      .map(([topic]) => (
                        <span key={topic} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          fontSize: t.caption.size, padding: `2px ${space[2]}px`,
                          background: `${colors.cyan[400]}10`, border: `1px solid ${colors.cyan[400]}20`,
                          borderRadius: radii.pill, color: colors.cyan[400],
                        }}>
                          {topic}
                          <button
                            onClick={(e) => { e.stopPropagation(); removeTopicAffinity(topic); }}
                            style={{
                              background: "transparent", border: "none", cursor: "pointer",
                              color: colors.cyan[400], padding: 0, fontSize: 14, lineHeight: 1,
                              display: "inline-flex", alignItems: "center",
                            }}
                          >&times;</button>
                        </span>
                      ))}
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <input
                        value={newTopic}
                        onChange={(e) => setNewTopic(e.target.value.slice(0, 30))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newTopic.trim()) {
                            const t = newTopic.trim().toLowerCase();
                            if ((profile.topicAffinities[t] ?? 0) < 0.2) {
                              setTopicAffinity(t, 0.3);
                            }
                            setNewTopic("");
                          }
                        }}
                        placeholder="+ Add topic"
                        style={{
                          width: 100, padding: `2px ${space[2]}px`,
                          background: "transparent",
                          border: `1px solid ${colors.border.default}`,
                          borderRadius: radii.pill,
                          color: colors.text.secondary,
                          fontSize: t.caption.size,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Threshold slider */}
                <div style={{ marginBottom: space[3] }}>
                  <div style={{ fontSize: t.caption.size, color: colors.text.disabled, marginBottom: space[2], fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Quality Threshold: <span style={{ color: colors.cyan[400], fontFamily: fonts.mono }}>{profile.calibration.qualityThreshold.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={1} max={9} step={0.5}
                    value={profile.calibration.qualityThreshold}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) setQualityThreshold(v); }}
                    style={{
                      width: "100%", accentColor: colors.cyan[400],
                      cursor: "pointer",
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[1] }}>
                    <span>More content</span>
                    <span>Stricter filtering</span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
                  <button
                    onClick={() => { showFeedback("Settings saved"); setSettingsOpen(false); }}
                    style={{
                      padding: `${space[2]}px ${space[4]}px`,
                      background: `${colors.cyan[400]}10`,
                      border: `1px solid ${colors.cyan[400]}25`,
                      borderRadius: radii.md,
                      color: colors.cyan[400],
                      fontSize: t.bodySm.size, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit",
                      transition: transitions.fast,
                    }}
                  >
                    Done
                  </button>
                  <span style={{ fontSize: t.tiny.size, color: colors.text.disabled }}>
                    Changes apply in real time
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* === Recent Activity with time-range tabs === */}
          <div style={{
            background: "transparent",
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: radii.lg,
            padding: `${space[3]}px ${space[4]}px`,
            marginBottom: space[4],
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: space[3],
            }}>
              <div style={{
                fontSize: t.bodySm.size, fontWeight: 600,
                color: colors.text.tertiary,
                display: "flex", alignItems: "center", gap: space[2],
              }}>
                <span>&#x26A1;</span> Recent Activity
              </div>
              <div style={{
                display: "flex", gap: space[1],
                background: colors.bg.raised, borderRadius: radii.md,
                padding: space[1], border: `1px solid ${colors.border.default}`,
              }}>
                {(["today", "7d", "30d"] as const).map(range => {
                  const active = activityRange === range;
                  return (
                    <button
                      key={range}
                      onClick={() => setActivityRange(range)}
                      style={{
                        padding: `${space[1]}px ${space[2]}px`,
                        background: active ? colors.bg.surface : "transparent",
                        border: active ? `1px solid ${colors.border.emphasis}` : "1px solid transparent",
                        borderRadius: radii.sm,
                        color: active ? colors.text.primary : colors.text.muted,
                        fontSize: t.caption.size, fontWeight: 600,
                        cursor: "pointer", fontFamily: "inherit",
                        transition: transitions.fast,
                      }}
                    >
                      {range === "today" ? "Today" : range}
                    </button>
                  );
                })}
              </div>
            </div>
            {dashboardActivity && (
              <>
                <div style={{ display: "flex", gap: space[4], marginBottom: space[3] }}>
                  {[
                    { value: dashboardActivity.qualityCount, label: "quality", color: colors.cyan[400] },
                    { value: dashboardActivity.slopCount, label: "burned", color: colors.orange[400] },
                    { value: dashboardActivity.totalEvaluated, label: "total", color: colors.purple[400] },
                  ].map(m => (
                    <span key={m.label} style={{ fontSize: t.bodySm.size, color: colors.text.muted }}>
                      <span style={{ fontWeight: 700, color: m.color, fontFamily: fonts.mono }}>{m.value}</span>
                      {" "}{m.label}
                    </span>
                  ))}
                </div>
                {dashboardActivity.chartQuality.length > 0 && (
                  <div style={{ display: "flex", gap: space[4], marginBottom: space[3], alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 80 }}>
                        <MiniChart data={dashboardActivity.chartQuality} color={colors.cyan[400]} h={24} />
                      </div>
                      <span style={{ fontSize: t.tiny.size, color: colors.cyan[400], fontFamily: fonts.mono }}>
                        {dashboardActivity.chartQuality[dashboardActivity.chartQuality.length - 1]}% quality
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 80 }}>
                        <MiniChart data={dashboardActivity.chartSlop} color={colors.orange[500]} h={24} />
                      </div>
                      <span style={{ fontSize: t.tiny.size, color: colors.orange[500], fontFamily: fonts.mono }}>
                        {dashboardActivity.chartSlop[dashboardActivity.chartSlop.length - 1]} slop
                      </span>
                    </div>
                  </div>
                )}
                {dashboardActivity.recentActions.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
                    {dashboardActivity.recentActions.map(item => (
                      <div key={item.id} style={{
                        display: "flex", alignItems: "center", gap: space[2],
                        fontSize: t.caption.size, color: colors.text.disabled,
                      }}>
                        <span style={{ color: item.validated ? colors.green[400] : colors.red[400] }}>
                          {item.validated ? "\u2713" : "\u2717"}
                        </span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.text.slice(0, 60)}
                        </span>
                        {item.topics && item.topics.length > 0 && (() => {
                          const topic = item.topics[0];
                          return (
                          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                            <button
                              onClick={() => {
                                const current = profile.topicAffinities[topic] ?? 0;
                                setTopicAffinity(topic, current + 0.1);
                                showFeedback(`[${topic}] \u2191`);
                              }}
                              style={{
                                background: "transparent", border: "none", cursor: "pointer",
                                color: colors.green[400], fontSize: t.caption.size, padding: "0 2px",
                                fontFamily: "inherit",
                              }}
                              title="More like this"
                            >&#x25B2;</button>
                            <button
                              onClick={() => {
                                const current = profile.topicAffinities[topic] ?? 0;
                                setTopicAffinity(topic, current - 0.1);
                                showFeedback(`[${topic}] \u2193`);
                              }}
                              style={{
                                background: "transparent", border: "none", cursor: "pointer",
                                color: colors.red[400], fontSize: t.caption.size, padding: "0 2px",
                                fontFamily: "inherit",
                              }}
                              title="Less like this"
                            >&#x25BC;</button>
                          </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <D2ANetworkMini mobile={mobile} />
          </div>

        </div>
      )}

      {content.length > 0 && (
        <div style={{ display: "flex", gap: space[2], marginTop: space[4] }}>
          {([
            { label: "Export CSV", onClick: exportCSV },
            { label: "Export JSON", onClick: exportJSON },
          ] as const).map(btn => (
            <button key={btn.label} onClick={btn.onClick} style={exportBtnStyle}>
              &#x1F4E5; {btn.label}
            </button>
          ))}
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

const exportBtnStyle: React.CSSProperties = {
  padding: `${space[2]}px ${space[4]}px`,
  background: colors.bg.surface,
  border: `1px solid ${colors.border.default}`,
  borderRadius: radii.md,
  color: colors.text.muted,
  fontSize: t.bodySm.size,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: transitions.fast,
};
