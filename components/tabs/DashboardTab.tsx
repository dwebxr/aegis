"use client";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard, deriveScoreTags, ScoreGrid, TopicTags } from "@/components/ui/ContentCard";
import { CheckIcon, XCloseIcon, ChevronDownIcon, GearIcon } from "@/components/icons";
import { fonts, colors, space, type as t, radii, transitions, scoreGrade } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import { contentToCSV } from "@/lib/utils/csv";
import { useFilterMode } from "@/contexts/FilterModeContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { getContext, hasEnoughData } from "@/lib/preferences/engine";
import { D2ANetworkMini } from "@/components/ui/D2ANetworkMini";
import { generateBriefing } from "@/lib/briefing/ranker";
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

const reasonBoxStyle: React.CSSProperties = {
  fontSize: t.bodySm.size, color: colors.text.tertiary, lineHeight: 1.5,
  fontStyle: "italic", background: colors.bg.raised,
  padding: `${space[2]}px ${space[3]}px`, borderRadius: radii.md,
  marginBottom: space[3], wordBreak: "break-word",
};

const expandToggleBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  background: "transparent", border: "none",
  color: colors.text.muted, fontSize: t.caption.size, fontWeight: 600,
  cursor: "pointer", padding: `${space[1]}px ${space[2]}px`,
  borderRadius: radii.sm, fontFamily: "inherit",
  transition: transitions.fast,
};

const actionBtnBase: React.CSSProperties = {
  flex: 1, padding: `${space[2]}px ${space[3]}px`,
  borderRadius: radii.md,
  fontSize: t.bodySm.size, fontWeight: 600,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
  transition: transitions.fast, fontFamily: "inherit",
};

const readMoreLinkStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: `${space[2]}px ${space[3]}px`,
  background: `${colors.blue[400]}10`,
  border: `1px solid ${colors.blue[400]}30`,
  borderRadius: radii.md,
  color: colors.blue[400], fontSize: t.bodySm.size, fontWeight: 600,
  textDecoration: "none", whiteSpace: "nowrap",
  transition: transitions.fast, fontFamily: "inherit",
};

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

function ExpandToggle({ isExpanded, onClick }: { isExpanded: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} style={expandToggleBtnStyle}>
      <span style={{
        display: "inline-flex",
        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.2s ease",
      }}>
        <ChevronDownIcon s={14} />
      </span>
      {isExpanded ? "Close" : "Details"}
    </button>
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
  return (
    <div style={{
      position: "relative", width: "100%", aspectRatio: "16/9",
      overflow: "hidden",
      background: showImg ? colors.bg.raised : `linear-gradient(135deg, ${gr.bg}, ${colors.bg.raised})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: space[1],
    }}>
      {showImg ? (
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
      {overlay}
    </div>
  );
}

function ExpandedDetails({ item, onValidate, onFlag }: {
  item: ContentItem;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
}) {
  return (
    <div
      style={{ marginTop: space[3], paddingTop: space[3], borderTop: `1px solid ${colors.border.default}`, overflow: "hidden" }}
      onClick={e => e.stopPropagation()}
    >
      <ScoreGrid item={item} />
      {item.reason && <div style={reasonBoxStyle}>{item.reason}</div>}
      {item.topics && item.topics.length > 0 && (
        <div style={{ marginBottom: space[3] }}><TopicTags topics={item.topics} /></div>
      )}
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
        {item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && (
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()} style={readMoreLinkStyle}>
            Read more &rarr;
          </a>
        )}
        <button disabled={item.validated} onClick={e => { e.stopPropagation(); onValidate(item.id); }}
          style={{
            ...actionBtnBase,
            background: item.validated ? `${colors.green[400]}18` : colors.green.bg,
            border: `1px solid ${colors.green.border}`, color: colors.green[400],
            cursor: item.validated ? "default" : "pointer", opacity: item.validated ? 0.6 : 1,
          }}>
          <CheckIcon /> {item.validated ? "Validated" : "Validate"}
        </button>
        <button disabled={item.flagged} onClick={e => { e.stopPropagation(); onFlag(item.id); }}
          style={{
            ...actionBtnBase,
            background: item.flagged ? `${colors.red[400]}18` : colors.red.bg,
            border: `1px solid ${colors.red.border}`, color: colors.red[400],
            cursor: item.flagged ? "default" : "pointer", opacity: item.flagged ? 0.6 : 1,
          }}>
          <XCloseIcon /> {item.flagged ? "Flagged" : "Flag Slop"}
        </button>
      </div>
    </div>
  );
}

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

/** Content-level dedup key: same article may have different IDs and URLs across sources */
function contentDedup(item: ContentItem): string {
  // Use normalized text prefix — catches same article regardless of URL differences
  return item.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
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

  // Reset expansion/pagination when filters change
  useEffect(() => {
    setExpanded(null);
    setShowAllContent(false);
  }, [verdictFilter, sourceFilter]);

  const filteredContent = useMemo(() => {
    let items = content;
    if (verdictFilter === "validated") {
      items = items.filter(c => c.validated);
      items = [...items].sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0));
    } else if (verdictFilter !== "all") {
      items = items.filter(c => c.verdict === verdictFilter);
    }
    if (sourceFilter !== "all") items = items.filter(c => c.source === sourceFilter);
    return items;
  }, [content, verdictFilter, sourceFilter]);

  const hasActiveFilter = verdictFilter !== "all" || sourceFilter !== "all";

  const agentContext = useMemo(() => {
    if (!hasEnoughData(profile)) return null;
    return getContext(profile);
  }, [profile]);

  // Dashboard computations: always computed, cached by profile.
  // Feed↔Dashboard toggle just shows/hides cached results — no recalculation.
  // Only profile changes (validate/flag) trigger fresh computation.
  const contentRef = useRef(content);
  contentRef.current = content;
  const briefingNowRef = useRef(Date.now());
  useEffect(() => {
    briefingNowRef.current = Date.now();
  }, [profile]);

  const dashboardTop3 = useMemo(() => {
    const briefing = generateBriefing(contentRef.current, profile, briefingNowRef.current);
    // Content-level dedup: same article may appear with different IDs from different sources
    const seenKeys = new Set<string>();
    const deduped = briefing.priority.filter(bi => {
      const key = contentDedup(bi.item);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    return deduped.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const dashboardTopicSpotlight = useMemo(() => {
    const highTopics = Object.entries(profile.topicAffinities)
      .filter(([, v]) => v >= 0.3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([k]) => k);
    if (highTopics.length === 0) return [];
    // Exclude items already shown in Today's Top 3
    const top3Ids = new Set(dashboardTop3.map(c => c.item.id));
    const currentContent = contentRef.current;
    const qualityItems = currentContent.filter(c => c.verdict === "quality" && !c.flagged && !top3Ids.has(c.id));
    // Pre-compile one regex per topic for word-boundary fallback matching
    const topicPatterns = new Map(highTopics.map(topic => {
      const escaped = topic.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return [topic, new RegExp(`\\b${escaped}\\b`, "i")];
    }));
    const matchesTopic = (c: ContentItem, topic: string) => {
      const t = topic.toLowerCase();
      if (c.topics?.some(tag => tag.toLowerCase() === t)) return true;
      const pattern = topicPatterns.get(topic);
      return pattern ? pattern.test(c.text) : false;
    };
    // Dedup across topic groups: higher-affinity topics claim items first
    // Content-level dedup: same article with different IDs from different sources
    const usedIds = new Set<string>();
    const usedContentKeys = new Set<string>();
    // Pre-populate with Top3 content keys so Spotlight never duplicates Top3
    for (const bi of dashboardTop3) usedContentKeys.add(contentDedup(bi.item));
    return highTopics.map(topic => {
      // Iterative selection: dedup keys are added as each item is picked,
      // so duplicates within the same topic group are caught immediately
      const sorted = qualityItems
        .filter(c => matchesTopic(c, topic) && !usedIds.has(c.id) && !usedContentKeys.has(contentDedup(c)))
        .sort((a, b) => b.scores.composite - a.scores.composite || a.id.localeCompare(b.id));
      const topicItems: ContentItem[] = [];
      for (const c of sorted) {
        const key = contentDedup(c);
        if (usedContentKeys.has(key)) continue;
        usedContentKeys.add(key);
        usedIds.add(c.id);
        topicItems.push(c);
        if (topicItems.length >= 3) break;
      }
      if (topicItems.length === 0) return null;
      return { topic, items: topicItems };
    }).filter(Boolean) as Array<{ topic: string; items: ContentItem[] }>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, dashboardTop3]);

  // Cascading cross-section deduplication: Top3 → Spotlight → Discoveries → Validated
  const shownByTopSections = useMemo(() => {
    const ids = new Set(dashboardTop3.map(c => c.item.id));
    for (const group of dashboardTopicSpotlight) {
      for (const item of group.items) ids.add(item.id);
    }
    return ids;
  }, [dashboardTop3, dashboardTopicSpotlight]);

  const filteredDiscoveries = useMemo(() => {
    return discoveries.filter(d => !shownByTopSections.has(d.item.id));
  }, [discoveries, shownByTopSections]);

  const allShownIds = useMemo(() => {
    const ids = new Set(shownByTopSections);
    for (const d of filteredDiscoveries) ids.add(d.item.id);
    return ids;
  }, [shownByTopSections, filteredDiscoveries]);

  const dashboardValidated = useMemo(() => {
    return contentRef.current
      .filter(c => c.validated && !allShownIds.has(c.id))
      .sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0))
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allShownIds]);

  const dashboardActivity = useMemo(() => {
    if (homeMode !== "dashboard") return null;
    const now = Date.now();
    const dayMs = 86400000;
    const rangeDays = activityRange === "30d" ? 30 : activityRange === "7d" ? 7 : 1;
    const rangeStart = now - rangeDays * dayMs;
    const rangeItems = content.filter(c => c.createdAt >= rangeStart);
    const actionLimit = activityRange === "today" ? 3 : 5;
    const recentActions = content
      .filter(c => c.validated || c.flagged)
      .sort((a, b) => (b.validatedAt ?? b.createdAt) - (a.validatedAt ?? a.createdAt))
      .slice(0, actionLimit);
    // Compute daily chart data for the selected range
    const chartDays = Math.min(rangeDays, 30);
    const chartQuality: number[] = [];
    const chartSlop: number[] = [];
    for (let i = chartDays - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * dayMs;
      const dayEnd = now - i * dayMs;
      const dayItems = content.filter(c => c.createdAt >= dayStart && c.createdAt < dayEnd);
      const dayQual = dayItems.filter(c => c.verdict === "quality").length;
      const dayTotal = dayItems.length;
      chartQuality.push(dayTotal > 0 ? Math.round((dayQual / dayTotal) * 100) : 0);
      chartSlop.push(dayItems.filter(c => c.verdict === "slop").length);
    }
    return {
      qualityCount: rangeItems.filter(c => c.verdict === "quality").length,
      slopCount: rangeItems.filter(c => c.verdict === "slop").length,
      totalEvaluated: rangeItems.length,
      recentActions,
      chartQuality,
      chartSlop,
    };
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
    <div style={{ animation: "fadeIn .4s ease" }}>
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
          {/* Compact metrics summary */}
          <div style={{
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
          <div style={{ gridColumn: mobile ? undefined : "1 / -1" }}>
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
                  const isExpanded = expanded === item.id;
                  return (
                    <div key={item.id} style={{
                      animation: `slideUp .3s ease ${i * 0.08}s forwards`,
                      background: colors.bg.surface,
                      border: `1px solid ${isExpanded ? colors.border.emphasis : colors.border.default}`,
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
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <ScorePill gr={gr} tag={tag} />
                          <ExpandToggle isExpanded={isExpanded} onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : item.id); }} />
                        </div>
                        {isExpanded && <ExpandedDetails item={item} onValidate={handleValidateWithFeedback} onFlag={handleFlagWithFeedback} />}
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
                    const heroExp = expanded === heroItem.id;
                    return (
                      <div key={topic} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                        <div style={{
                          background: colors.bg.surface,
                          border: `1px solid ${heroExp ? colors.border.emphasis : colors.border.default}`,
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
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <ScorePill gr={heroGr} tag={heroTag} />
                              <ExpandToggle isExpanded={heroExp} onClick={(e) => { e.stopPropagation(); setExpanded(heroExp ? null : heroItem.id); }} />
                            </div>
                            {heroExp && <ExpandedDetails item={heroItem} onValidate={handleValidateWithFeedback} onFlag={handleFlagWithFeedback} />}
                          </div>
                        </div>
                        {runnerUps.map((ruItem, ruIdx) => {
                          const ruGr = scoreGrade(ruItem.scores.composite);
                          const ruTag = deriveScoreTags(ruItem)[0] ?? null;
                          const ruExp = expanded === ruItem.id;
                          const showThumb = ruItem.imageUrl && !failedImages.has(ruItem.id);
                          const isLast = ruIdx === runnerUps.length - 1;
                          return (
                            <div key={ruItem.id} style={{
                              background: colors.bg.surface,
                              borderLeft: `1px solid ${colors.border.default}`,
                              borderRight: `1px solid ${colors.border.default}`,
                              borderBottom: `1px solid ${ruExp ? colors.border.emphasis : colors.border.default}`,
                              borderTop: "none",
                              borderRadius: isLast
                                ? `0 0 ${typeof radii.lg === "number" ? radii.lg : 12}px ${typeof radii.lg === "number" ? radii.lg : 12}px`
                                : undefined,
                              overflow: "hidden",
                              transition: transitions.fast,
                            }}>
                              <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                                <div style={{
                                  width: 80, minHeight: 60, flexShrink: 0,
                                  overflow: "hidden",
                                  background: showThumb ? colors.bg.raised : `linear-gradient(135deg, ${ruGr.bg}, ${colors.bg.raised})`,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  flexDirection: "column", gap: 2,
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
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <ScorePill gr={ruGr} tag={ruTag} />
                                    <ExpandToggle isExpanded={ruExp} onClick={(e) => { e.stopPropagation(); setExpanded(ruExp ? null : ruItem.id); }} />
                                  </div>
                                </div>
                              </div>
                              {ruExp && <ExpandedDetails item={ruItem} onValidate={handleValidateWithFeedback} onFlag={handleFlagWithFeedback} />}
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
                  const isExp = expanded === item.id;
                  const showThumb = item.imageUrl && !failedImages.has(item.id);
                  return (
                    <div key={item.id} style={{
                      background: colors.bg.surface,
                      border: `1px solid ${isExp ? colors.border.emphasis : colors.border.default}`,
                      borderRadius: radii.md,
                      overflow: "hidden", transition: transitions.fast,
                    }}>
                      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                        <div style={{
                          width: 80, minHeight: 60, flexShrink: 0,
                          overflow: "hidden",
                          background: showThumb ? colors.bg.raised : `linear-gradient(135deg, ${gr.bg}, ${colors.bg.raised})`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexDirection: "column", gap: 2,
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
                        <div style={{ flex: 1, minWidth: 0, padding: `${space[3]}px ${space[4]}px` }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space[1] }}>
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
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <ScorePill gr={gr} tag={tag} />
                            <ExpandToggle isExpanded={isExp} onClick={(e) => { e.stopPropagation(); setExpanded(isExp ? null : item.id); }} />
                          </div>
                        </div>
                      </div>
                      {isExp && <ExpandedDetails item={item} onValidate={handleValidateWithFeedback} onFlag={handleFlagWithFeedback} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                  const isExp = expanded === item.id;
                  const showThumb = item.imageUrl && !failedImages.has(item.id);
                  return (
                    <div key={item.id} style={{
                      background: colors.bg.surface,
                      border: `1px solid ${isExp ? colors.border.emphasis : colors.border.default}`,
                      borderRadius: radii.md,
                      overflow: "hidden", transition: transitions.fast,
                    }}>
                      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                        <div style={{
                          width: 80, minHeight: 60, flexShrink: 0,
                          overflow: "hidden",
                          background: showThumb ? colors.bg.raised : `linear-gradient(135deg, ${gr.bg}, ${colors.bg.raised})`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexDirection: "column", gap: 2,
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
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <ScorePill gr={gr} tag={tag} />
                            <ExpandToggle isExpanded={isExp} onClick={(e) => { e.stopPropagation(); setExpanded(isExp ? null : item.id); }} />
                          </div>
                        </div>
                      </div>
                      {isExp && <ExpandedDetails item={item} onValidate={handleValidateWithFeedback} onFlag={handleFlagWithFeedback} />}
                    </div>
                  );
                })}
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
