"use client";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/design";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard, deriveScoreTags } from "@/components/ui/ContentCard";
import { colors, scoreGrade } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import { exportContentCSV, exportContentJSON } from "@/lib/utils/export";
import { extractYouTubeVideoId } from "@/lib/utils/youtube";
import { useFilterMode } from "@/contexts/FilterModeContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { getContext, hasEnoughData } from "@/lib/preferences/engine";
import { D2ANetworkMini } from "@/components/ui/D2ANetworkMini";
import { BriefingClassificationBadge } from "@/components/ui/BriefingClassificationBadge";
import {
  applyDashboardFilters,
  applyLatestFilter,
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
import { useAutoReveal } from "@/hooks/useAutoReveal";
import { deduplicateItems } from "@/contexts/content/dedup";

function ScorePill({ gr, tag }: { gr: ReturnType<typeof scoreGrade>; tag: { label: string; color: string } | null }) {
  return (
    <div
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-caption font-bold shrink-0"
      style={{ background: `${gr.color}12`, border: `1px solid ${gr.color}25` }}
    >
      <span className="font-mono" style={{ color: gr.color }}>{gr.grade}</span>
      {tag && (
        <>
          <span className="text-disabled">&middot;</span>
          <span className="uppercase text-tiny tracking-wide whitespace-nowrap" style={{ color: tag.color }}>{tag.label}</span>
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
    <div
      className={cn(
        "relative w-full aspect-video overflow-hidden flex items-center justify-center flex-col gap-1",
        !showImg && !ytVideoId && "bg-navy-lighter"
      )}
      style={showImg ? undefined : { background: `linear-gradient(135deg, ${gr.bg}, var(--color-bg-raised))` }}
    >
      {ytVideoId ? (
        <iframe
          src={`https://www.youtube.com/embed/${ytVideoId}`}
          title={item.text?.slice(0, 60) || "YouTube video"}
          className="w-full h-full border-none block"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : showImg ? (
        /* eslint-disable-next-line @next/next/no-img-element -- dashboard card OG thumbnail */
        <img src={item.imageUrl!} alt="" loading="lazy"
          className="w-full h-full object-cover block"
          onError={onImgError} />
      ) : (
        <>
          <span className="font-mono" style={{ fontSize: gradeSize, fontWeight: 800, color: gr.color }}>{gr.grade}</span>
          <span className="text-caption text-disabled">{item.platform || item.source}</span>
        </>
      )}
      {overlay && (
        <div className={cn("absolute inset-0", ytVideoId && "pointer-events-none")}>
          {overlay}
        </div>
      )}
    </div>
  );

  if (!ytVideoId && hasLink) {
    return (
      <a href={item.sourceUrl!} target="_blank" rel="noopener noreferrer" className="block no-underline">
        {inner}
      </a>
    );
  }
  return inner;
}

function DashboardCard({ item, failedImages, markImgFailed, bookmarkSet, onBookmark, onValidate, onFlag,
  gradeSize = 36, textClamp = 2, textSlice = 150, textWeight = 600, showPlatform, overlay, topContent, className: extraClass,
}: {
  item: ContentItem;
  failedImages: Set<string>;
  markImgFailed: (id: string) => void;
  bookmarkSet: Set<string>;
  onBookmark: (id: string) => void;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  gradeSize?: number;
  textClamp?: number;
  textSlice?: number;
  textWeight?: number;
  showPlatform?: boolean;
  overlay?: React.ReactNode;
  topContent?: React.ReactNode;
  className?: string;
}) {
  const gr = scoreGrade(item.scores.composite);
  const tag = deriveScoreTags(item)[0] ?? null;
  return (
    <div className={cn("bg-card border border-border rounded-lg overflow-hidden transition-fast", extraClass)}>
      <ThumbnailArea item={item} gr={gr} gradeSize={gradeSize}
        imgFailed={failedImages.has(item.id)} onImgError={() => markImgFailed(item.id)}
        overlay={overlay}
      />
      <div className="px-4 py-3">
        {topContent}
        <div
          className="text-body text-secondary-foreground overflow-hidden mb-2 break-words"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: textClamp,
            WebkitBoxOrient: "vertical" as const,
            lineHeight: 1.4,
            fontWeight: textWeight,
          }}
        >
          {item.text.slice(0, textSlice)}
        </div>
        <div className="text-caption text-disabled overflow-hidden text-ellipsis whitespace-nowrap mb-3">
          {item.author} &middot; {showPlatform ? (item.platform || item.source) : item.source} &middot; {item.timestamp}
        </div>
        <div className="flex items-center gap-2">
          <ScorePill gr={gr} tag={tag} />
          <div className="flex-1" />
          <button onClick={(e) => { e.stopPropagation(); onBookmark(item.id); }}
            className={cn(
              "px-2 py-0.5 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
              bookmarkSet.has(item.id)
                ? "bg-amber-400/[0.09] border border-amber-400/[0.19] text-amber-400"
                : "bg-transparent border border-border text-muted-foreground"
            )}>&#x1F516;</button>
          <button onClick={(e) => { e.stopPropagation(); onValidate(item.id); }}
            disabled={item.validated}
            className={cn(
              "px-2 py-0.5 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
              "bg-emerald-500/[0.08] border border-emerald-500/20 text-emerald-400",
              item.validated && "opacity-50 cursor-default"
            )}>&#x2713;</button>
          <button onClick={(e) => { e.stopPropagation(); onFlag(item.id); }}
            disabled={item.flagged}
            className={cn(
              "px-2 py-0.5 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
              "bg-red-500/[0.08] border border-red-500/20 text-red-400",
              item.flagged && "opacity-50 cursor-default"
            )}>&#x2717;</button>
        </div>
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
      <div className="flex flex-wrap gap-2">
        {agentContext.highAffinityTopics.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-caption text-disabled">Interests:</span>
            {agentContext.highAffinityTopics.slice(0, 6).map(topic => (
              <span key={topic} className="text-caption px-2 py-px bg-cyan-400/[0.06] border border-cyan-400/[0.12] rounded-full text-cyan-400">
                {topic}
              </span>
            ))}
          </div>
        )}
        {agentContext.trustedAuthors.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-caption text-disabled">Trusted:</span>
            {agentContext.trustedAuthors.slice(0, 4).map(author => (
              <span key={author} className="text-caption px-2 py-px bg-emerald-400/[0.06] border border-emerald-400/[0.12] rounded-full text-emerald-400">
                {author}
              </span>
            ))}
          </div>
        )}
        {agentContext.highAffinityTopics.length === 0 && agentContext.trustedAuthors.length === 0 && (
          <span className="text-caption text-disabled">
            Validate or flag content to teach your agent.
          </span>
        )}
      </div>
      <div className="text-tiny text-disabled mt-2">
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
  const [verdictFilter, setVerdictFilter] = useState<"all" | "quality" | "slop" | "validated" | "bookmarked">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const moreFiltersRef = useRef<HTMLDivElement>(null);
  const [showAllContent, setShowAllContent] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const markImgFailed = useCallback((id: string) =>
    setFailedImages(prev => { const next = new Set(prev); next.add(id); return next; }), []);
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
  const [sortMode, setSortMode] = useState<"latest" | "ranked">(() => {
    if (typeof window === "undefined") return "latest";
    try { return localStorage.getItem("aegis-sort-mode") === "ranked" ? "ranked" : "latest"; }
    catch { return "latest"; }
  });
  const { profile, addFilterRule, bookmarkItem, unbookmarkItem } = usePreferences();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("aegis-home-mode", homeMode); } catch { console.debug("[dashboard] localStorage unavailable"); }
  }, [homeMode]);

  useEffect(() => {
    try { localStorage.setItem("aegis-sort-mode", sortMode); } catch { console.debug("[dashboard] localStorage unavailable"); }
  }, [sortMode]);

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
  }, [verdictFilter, sourceFilter, sortMode]);

  // Close "More filters" dropdown on click-outside or Escape
  useEffect(() => {
    if (!moreFiltersOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (moreFiltersRef.current && !moreFiltersRef.current.contains(e.target as Node)) {
        setMoreFiltersOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreFiltersOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [moreFiltersOpen]);

  const filteredContent = useMemo(() => {
    if (sortMode === "latest") {
      return deduplicateItems(applyLatestFilter(content, verdictFilter, sourceFilter, profile.bookmarkedIds ?? []));
    }
    if (verdictFilter === "bookmarked") {
      const bookmarkSet = new Set(profile.bookmarkedIds ?? []);
      return deduplicateItems(content.filter(c => bookmarkSet.has(c.id)).sort((a, b) => b.createdAt - a.createdAt));
    }
    return deduplicateItems(applyDashboardFilters(content, verdictFilter, sourceFilter));
  }, [content, verdictFilter, sourceFilter, profile.bookmarkedIds, sortMode]);

  const clusteredContent = useMemo(
    () => homeMode === "feed" && sortMode === "ranked" ? clusterByStory(filteredContent) : [],
    [filteredContent, homeMode, sortMode],
  );

  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  // Auto-reveal: sections expand when scrolled into view, remember manual collapses
  const { isExpanded: isSectionExpanded, toggle: toggleSection, observeRef: sectionRef } = useAutoReveal();

  const hasActiveFilter = verdictFilter !== "all" || sourceFilter !== "all";
  const moreFiltersActive = verdictFilter === "all" || verdictFilter === "slop" || sourceFilter !== "all";

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

  const { filteredDiscoveries, unreviewedQueue, dashboardSaved } = useMemo(() => {
    if (homeMode !== "dashboard") return EMPTY_SECTIONS;
    const topIds = new Set(dashboardTop3.map(c => c.item.id));
    for (const group of dashboardTopicSpotlight) {
      for (const item of group.items) topIds.add(item.id);
    }
    const filtDisc = discoveries.filter(d => !topIds.has(d.item.id)).slice(0, 3);
    for (const d of filtDisc) topIds.add(d.item.id);
    const queue = computeUnreviewedQueue(contentRef.current, topIds).slice(0, 3);
    for (const item of queue) topIds.add(item.id);
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

  const cardProps = useMemo(() => ({ failedImages, markImgFailed, bookmarkSet, onBookmark: handleBookmark, onValidate: handleValidateWithFeedback, onFlag: handleFlagWithFeedback }), [failedImages, markImgFailed, bookmarkSet, handleBookmark, handleValidateWithFeedback, handleFlagWithFeedback]);

  const handleToggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);

  useEffect(() => {
    return () => { clearTimeout(feedbackTimerRef.current); };
  }, []);

  const feedItemIds = useMemo(() => {
    if (sortMode === "latest") return filteredContent.slice(0, showAllContent ? 50 : 5).map(c => c.id);
    return clusteredContent.slice(0, showAllContent ? 50 : 5).map(c => c.representative.id);
  }, [sortMode, filteredContent, clusteredContent, showAllContent]);

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
    { label: "Sort: Latest", action: () => setSortMode("latest") },
    { label: "Sort: Ranked", action: () => setSortMode("ranked") },
    { label: "Filter: Quality", action: () => setVerdictFilter("quality") },
    { label: "Filter: Slop", action: () => setVerdictFilter("slop") },
    { label: "Filter: All", action: () => setVerdictFilter("all") },
    { label: "Filter: Validated", action: () => setVerdictFilter("validated") },
    { label: "Filter: Saved", action: () => setVerdictFilter("bookmarked") },
    { label: "Export CSV", action: () => exportContentCSV(content) },
    { label: "Export JSON", action: () => exportContentJSON(content) },
  ], [onTabChange, content]);

  return (
    <div data-testid="aegis-dashboard" className="animate-fade-in">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h1 className={cn("text-foreground m-0", mobile ? "text-[20px] font-bold" : typography.h1)}>
          Home
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-navy-lighter rounded-md p-1 border border-border">
            {(["feed", "dashboard"] as const).map(mode => {
              const active = homeMode === mode;
              return (
                <button
                  key={mode}
                  data-testid={`aegis-home-mode-${mode}`}
                  onClick={() => setHomeMode(mode)}
                  className={cn(
                    "px-3 py-2 rounded-sm text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast capitalize",
                    active
                      ? "bg-card border border-emphasis text-foreground"
                      : "bg-transparent border border-transparent text-muted-foreground"
                  )}
                >
                  {mode === "feed" ? "Feed" : "Dashboard"}
                </button>
              );
            })}
          </div>
          {homeMode === "feed" && (
            <div className="flex gap-1 bg-navy-lighter rounded-md p-1 border border-border">
              {(["latest", "ranked"] as const).map(mode => {
                const active = sortMode === mode;
                return (
                  <button
                    key={mode}
                    data-testid={`aegis-sort-mode-${mode}`}
                    onClick={() => setSortMode(mode)}
                    className={cn(
                      "px-3 py-2 rounded-sm text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast capitalize",
                      active
                        ? "bg-card border border-emphasis text-foreground"
                        : "bg-transparent border border-transparent text-muted-foreground"
                    )}
                  >
                    {mode === "latest" ? "Latest" : "Ranked"}
                  </button>
                );
              })}
            </div>
          )}
          <button
            onClick={() => onTabChange?.("settings:feeds")}
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1 rounded-full text-caption font-bold cursor-pointer font-[inherit] transition-fast",
              filterMode === "pro"
                ? "bg-sky-400/10 border border-sky-400/20 text-sky-400"
                : "bg-navy-lighter border border-border text-muted-foreground"
            )}
            title="Change in Settings > Feeds"
          >
            {filterMode === "pro" ? "Pro" : "Lite"}
          </button>
          {wotLoading && (
            <span className="text-caption text-disabled animate-pulse">
              &#x1F310; WoT...
            </span>
          )}
        </div>
      </div>

      {/* Signal feedback loop message */}
      {feedbackMsg && (
        <div
          key={feedbackMsg.key}
          className="my-2 px-4 py-2 bg-purple-500/[0.06] border border-purple-500/15 rounded-md text-body-sm text-purple-400 font-semibold text-center animate-fade-in"
        >
          &#x1F4E1; Agent learned: {feedbackMsg.text}
        </div>
      )}

      {homeMode === "feed" && (
        <>
          <div data-testid="aegis-metrics-bar" className={cn(
            "flex flex-wrap items-center mb-3 px-4 py-2 bg-card border border-border rounded-md",
            mobile ? "gap-3" : "gap-4"
          )}>
            <div className="flex flex-wrap gap-3 flex-1">
              {[
                { icon: "\u{1F6E1}", value: todayQual.length, label: "quality", colorClass: "text-cyan-400" },
                { icon: "\u{1F525}", value: todaySlop.length, label: "burned", colorClass: "text-orange-400" },
                { icon: "\u26A1", value: todayContent.length, label: "eval", colorClass: "text-purple-400" },
                { icon: "\u{1F4E1}", value: uniqueSources.size, label: "sources", colorClass: "text-sky-400" },
              ].map(m => (
                <span key={m.label} className="flex items-center gap-1 text-body-sm text-muted-foreground">
                  <span>{m.icon}</span>
                  <span className={cn("font-bold font-mono", m.colorClass)}>{m.value}</span>
                  <span>{m.label}</span>
                </span>
              ))}
            </div>
            <div className="flex gap-3 items-center">
              <div className="flex items-center gap-1">
                <div className="w-[60px]">
                  <MiniChart data={dailyQuality} color={colors.cyan[400]} h={20} />
                </div>
                <span className="text-tiny text-cyan-400 font-mono">
                  {dailyQuality.length > 0 ? dailyQuality[dailyQuality.length - 1] : 0}%
                </span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-[60px]">
                  <MiniChart data={dailySlop} color={colors.orange[500]} h={20} />
                </div>
                <span className="text-tiny text-orange-500 font-mono">
                  {dailySlop.length > 0 ? dailySlop[dailySlop.length - 1] : 0}
                </span>
              </div>
            </div>
          </div>

          {/* Content filters */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-h3 font-semibold text-tertiary">
              Filtered Signal {hasActiveFilter && <span data-testid="aegis-filter-count" className="text-body-sm text-disabled">({filteredContent.length})</span>}
            </div>
            <div className="flex gap-1 flex-wrap items-center">
              {/* Primary filter buttons */}
              {([
                { id: "quality" as const, label: "Quality", activeClass: "bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-400" },
                { id: "bookmarked" as const, label: "\uD83D\uDD16 Saved", activeClass: "bg-cyan-500/[0.05] border-cyan-500/[0.15] text-cyan-400" },
                { id: "validated" as const, label: "\u2713 Validated", activeClass: "bg-purple-400/[0.06] border-purple-400/15 text-purple-400" },
              ]).map(({ id: v, label, activeClass }) => (
                <button
                  key={v}
                  data-testid={`aegis-filter-${v}`}
                  aria-pressed={verdictFilter === v}
                  onClick={() => { setVerdictFilter(v); setMoreFiltersOpen(false); }}
                  className={cn(
                    "px-3 py-1 rounded-full text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
                    verdictFilter === v
                      ? `border ${activeClass}`
                      : "bg-transparent border border-border text-disabled"
                  )}
                >
                  {label}
                </button>
              ))}

              {/* "More filters" dropdown */}
              <div ref={moreFiltersRef} className="relative">
                <button
                  data-testid="aegis-filter-more"
                  aria-expanded={moreFiltersOpen}
                  aria-haspopup="true"
                  onClick={() => setMoreFiltersOpen(prev => !prev)}
                  className={cn(
                    "inline-flex items-center gap-1 px-3 py-1 rounded-full text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
                    moreFiltersActive
                      ? "bg-navy-lighter border border-emphasis text-secondary-foreground"
                      : "bg-transparent border border-border text-disabled"
                  )}
                >
                  More filters
                  {moreFiltersActive && (
                    <span className="size-1.5 rounded-full bg-cyan-400 shrink-0" />
                  )}
                  <span className="text-caption leading-none">{moreFiltersOpen ? "\u25B4" : "\u25BE"}</span>
                </button>

                {moreFiltersOpen && (
                  <div
                    data-testid="aegis-filter-more-panel"
                    role="menu"
                    className="absolute right-0 top-[calc(100%+4px)] min-w-[160px] z-50 bg-card border border-border rounded-md py-2 shadow-lg"
                  >
                    {/* VERDICT section */}
                    <div className="px-3 py-1 text-tiny font-bold text-disabled uppercase tracking-wide">Verdict</div>
                    {([
                      { id: "all" as const, label: "All" },
                      { id: "slop" as const, label: "Slop" },
                    ]).map(({ id: v, label }) => (
                      <button
                        key={v}
                        role="menuitem"
                        data-testid={`aegis-filter-${v}`}
                        aria-current={verdictFilter === v ? "true" : undefined}
                        onClick={() => { setVerdictFilter(v); setMoreFiltersOpen(false); }}
                        className={cn(
                          "block w-full text-left px-3 py-2 border-none text-body-sm cursor-pointer font-[inherit] transition-fast",
                          verdictFilter === v
                            ? "bg-cyan-400/[0.06] text-cyan-400 font-bold"
                            : "bg-transparent text-muted-foreground font-medium"
                        )}
                      >{label}</button>
                    ))}

                    {/* Separator */}
                    <div className="h-px bg-border my-2" />

                    {/* SOURCE section */}
                    <div className="px-3 py-1 text-tiny font-bold text-disabled uppercase tracking-wide">Source</div>
                    {["all", ...availableSources].map(s => (
                      <button
                        key={s}
                        role="menuitem"
                        onClick={() => { setSourceFilter(s); setMoreFiltersOpen(false); }}
                        className={cn(
                          "block w-full text-left px-3 py-2 border-none text-body-sm cursor-pointer font-[inherit] transition-fast",
                          sourceFilter === s
                            ? "bg-cyan-400/[0.06] text-cyan-400 font-bold"
                            : "bg-transparent text-muted-foreground font-medium"
                        )}
                      >{s === "all" ? "All sources" : s}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content list */}
          {isLoading ? (
            <div className="text-center p-10 text-muted-foreground bg-card rounded-lg border border-border mb-4">
              <div className="text-[32px] mb-3 animate-pulse">&#x1F6E1;</div>
              <div className="text-h3 font-semibold text-tertiary">Loading content...</div>
              <div className="text-body-sm mt-2">Syncing from Internet Computer</div>
            </div>
          ) : filteredContent.length === 0 ? (
            <>
              {hasActiveFilter ? (
                <div className="text-center p-10 text-muted-foreground bg-card rounded-lg border border-border mb-4">
                  <div className="text-[32px] mb-3">&#x1F50D;</div>
                  <div className="text-h3 font-semibold text-tertiary">No matching content</div>
                  <div className="text-body-sm mt-2">Try adjusting your filters</div>
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
                <div className="text-center p-10 text-muted-foreground bg-card rounded-lg border border-border mb-4">
                  <div className="text-[32px] mb-3">&#x1F50D;</div>
                  <div className="text-h3 font-semibold text-tertiary">No content yet</div>
                  <div className="text-body-sm mt-2">Add sources to start filtering, or try the incinerator for manual evaluation</div>
                </div>
              )}
            </>
          ) : (
            <>
              {pendingCount > 0 && onFlushPending && (
                <NewItemsBar count={pendingCount} onFlush={onFlushPending} />
              )}
              {sortMode === "latest" ? (
                <>
                  {filteredContent.slice(0, showAllContent ? 50 : 5).map((item, i) => (
                    <div key={item.id} style={{ animation: `slideUp .2s ease ${i * 0.03}s both` }}>
                      {verdictFilter === "validated" && item.validatedAt && (
                        <div className="text-caption text-purple-400 mb-1 ml-1 font-mono font-semibold">
                          Validated {new Date(item.validatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          {" "}
                          {new Date(item.validatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                      <ContentCard
                        item={item}
                        expanded={expanded === item.id}
                        onToggle={handleToggle}
                        onValidate={handleValidateWithFeedback}
                        onFlag={handleFlagWithFeedback}
                        onBookmark={handleBookmark}
                        isBookmarked={bookmarkSet.has(item.id)}
                        onAddFilterRule={addFilterRule}
                        mobile={mobile}
                        focused={focusedId === item.id}
                      />
                    </div>
                  ))}
                  {filteredContent.length > 5 && !showAllContent && (
                    <button
                      onClick={() => setShowAllContent(true)}
                      className="w-full px-4 py-3 bg-card border border-border rounded-md text-muted-foreground text-body-sm font-semibold cursor-pointer font-[inherit] transition-normal mt-2"
                    >
                      Show all ({filteredContent.length} items)
                    </button>
                  )}
                </>
              ) : (
                <>
                  {clusteredContent.slice(0, showAllContent ? 50 : 5).map((cluster, i) => {
                    const rep = cluster.representative;
                    const hasCluster = cluster.members.length > 1;
                    const clusterExpanded = expandedClusters.has(rep.id);
                    return (
                      <div key={rep.id} style={{ animation: `slideUp .2s ease ${i * 0.03}s both` }}>
                        {verdictFilter === "validated" && rep.validatedAt && (
                          <div className="text-caption text-purple-400 mb-1 ml-1 font-mono font-semibold">
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
                            className="flex items-center gap-1 px-3 py-1 my-1 ml-4 mb-2 bg-transparent border border-subtle rounded-full text-muted-foreground text-caption font-semibold cursor-pointer font-[inherit] transition-fast"
                          >
                            <span className={cn("inline-block transition-fast", clusterExpanded && "rotate-180")}>&#x25BC;</span>
                            {clusterExpanded ? "Hide" : `+${cluster.members.length - 1} related`}
                            {cluster.sharedTopics.length > 0 && ` \u00B7 ${cluster.sharedTopics.slice(0, 2).join(", ")}`}
                          </button>
                        )}
                        {hasCluster && clusterExpanded && cluster.members.slice(1).map(m => (
                          <div key={m.id} className="ml-4 border-l-2 border-subtle pl-3">
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
                      className="w-full px-4 py-3 bg-card border border-border rounded-md text-muted-foreground text-body-sm font-semibold cursor-pointer font-[inherit] transition-normal mt-2"
                    >
                      Show all ({filteredContent.length} items in {clusteredContent.length} groups)
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* Agent Knowledge */}
          {agentContext && (
            <div
              className={cn(
                "mt-4 px-4 py-3 bg-card rounded-md transition-all duration-500",
                agentKnowsHighlight
                  ? "border border-purple-500/30 shadow-[0_0_12px_rgba(139,92,246,0.1)]"
                  : "border border-border"
              )}
            >
              <div className="text-body-sm font-semibold text-tertiary mb-2">
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
        <div className="mt-3">
          {/* Today's Top 3 */}
          <div data-testid="aegis-top3-section" className="mb-4">
            <div className="text-h3 font-semibold text-tertiary mb-3 flex items-center gap-2">
              <span>&#x2B50;</span> Today&#39;s Top 3
              <div className="flex-1" />
              <button
                onClick={() => { setHomeMode("feed"); setVerdictFilter("all"); }}
                className="text-caption font-semibold text-cyan-400 bg-transparent border-none cursor-pointer font-[inherit]"
              >
                Review All &rarr;
              </button>
            </div>
            {dashboardTop3.length === 0 ? (
              <div className="text-body-sm text-disabled text-center p-4 bg-card border border-border rounded-lg">
                No quality items scored yet.
              </div>
            ) : (
              <div className={cn(mobile ? "flex flex-col gap-4" : "grid grid-cols-3 gap-4")}>
                {dashboardTop3.map((bi, i) => (
                  <DashboardCard
                    key={bi.item.id} item={bi.item} {...cardProps}
                    gradeSize={48} textClamp={3} textSlice={200} textWeight={700} showPlatform
                    className={`animate-[slideUp_.3s_ease_${i * 0.08}s_forwards]`}
                    overlay={
                      <div className="absolute top-2 left-2 size-7 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-body-sm font-[800] text-white shadow-md">
                        {i + 1}
                      </div>
                    }
                    topContent={bi.classification !== "mixed" ? (
                      <div className="mb-1">
                        <BriefingClassificationBadge classification={bi.classification} />
                      </div>
                    ) : undefined}
                  />
                ))}
              </div>
            )}
          </div>

            {/* Topic Spotlight */}
            <div className="mb-4">
              <div className="text-h3 font-semibold text-tertiary mb-3 flex items-center gap-2">
                <span>&#x1F3AF;</span> Topic Spotlight
              </div>
              {dashboardTopicSpotlight.length === 0 ? (
                <div className="text-body-sm text-disabled text-center p-4 bg-card border border-border rounded-lg">
                  Validate more content to refine recommendations.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {dashboardTopicSpotlight.map(({ topic, items }) => {
                    const topicId = `topic:${topic}`;
                    const expanded = isSectionExpanded(topicId);
                    return (
                      <div key={topic} ref={sectionRef(topicId)} className="bg-transparent border border-subtle rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleSection(topicId)}
                          className={cn(
                            "w-full px-4 py-3 border-none cursor-pointer flex items-center gap-2 font-[inherit] transition-fast",
                            expanded ? "bg-card" : "bg-transparent"
                          )}
                        >
                          <span className="text-body-sm font-bold px-2 py-0.5 bg-cyan-500/10 rounded-full text-cyan-400">
                            {topic}
                          </span>
                          <span className="text-caption text-muted-foreground bg-navy-lighter px-2 py-0.5 rounded-sm">
                            {items.length}
                          </span>
                          <div className="flex-1" />
                          <span className={cn(
                            "transition-fast text-xs text-muted-foreground",
                            expanded && "rotate-180"
                          )}>
                            &#x25BC;
                          </span>
                        </button>
                        {expanded && (
                          <div className="px-4 py-3 border-t border-subtle" style={{ animation: "slideDown .2s ease forwards" }}>
                            <div className={cn(mobile ? "flex flex-col gap-4" : "grid grid-cols-3 gap-4")}>
                              {items.map(item => (
                                <DashboardCard key={item.id} item={item} {...cardProps} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          {/* Your Agent */}
          <div className={cn(
            "px-4 py-3 bg-card rounded-lg mb-4 transition-all duration-500",
            agentKnowsHighlight
              ? "border border-purple-500/30 shadow-[0_0_12px_rgba(139,92,246,0.1)]"
              : "border border-border"
          )}>
            <div className={cn("flex items-center gap-2", agentContext && "mb-2")}>
              <span>&#x1F9E0;</span>
              <span className="text-body-sm font-semibold text-tertiary">Your Agent</span>
              <span className="text-caption text-disabled font-normal overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                {Object.entries(profile.topicAffinities).filter(([, v]) => v >= 0.2).length} interests
                &middot; {profile.totalValidated + profile.totalFlagged} reviews
                &middot; threshold {profile.calibration.qualityThreshold.toFixed(1)}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => onTabChange?.("settings:agent")}
                className="px-3 py-1 bg-cyan-400/[0.06] border border-cyan-400/[0.15] rounded-md text-cyan-400 text-caption font-semibold cursor-pointer font-[inherit] transition-fast whitespace-nowrap shrink-0"
              >
                Edit settings
              </button>
            </div>
            {agentContext && <AgentKnowledgePills agentContext={agentContext} profile={profile} />}
          </div>

          {/* Discoveries - Collapsible */}
          {filteredDiscoveries.length > 0 && (
            <CollapsibleSection
              id="discoveries"
              title="Discoveries"
              icon="&#x1F52D;"
              isExpanded={isSectionExpanded('discoveries')}
              onToggle={toggleSection}
              wrapperRef={sectionRef('discoveries')}
              itemCount={filteredDiscoveries.length}
              mobile={mobile}
            >
              <div className={cn(mobile ? "flex flex-col gap-4" : "grid grid-cols-3 gap-4")}>
                {filteredDiscoveries.map(d => (
                  <DashboardCard key={d.item.id} item={d.item} {...cardProps}
                    overlay={d.reason && (
                      <div className="absolute bottom-2 left-2 right-2">
                        <SerendipityBadge discoveryType={d.discoveryType} />
                      </div>
                    )}
                  />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Needs Review - Collapsible */}
          {unreviewedQueue.length > 0 && (
            <div className="my-4">
            <CollapsibleSection
              id="review-queue"
              title="Needs Review"
              icon="&#x1F4CB;"
              isExpanded={isSectionExpanded('review-queue')}
              onToggle={toggleSection}
              wrapperRef={sectionRef('review-queue')}
              itemCount={unreviewedQueue.length}
              mobile={mobile}
            >
              <div className={cn(mobile ? "flex flex-col gap-4" : "grid grid-cols-3 gap-4")}>
                {unreviewedQueue.map(item => (
                  <DashboardCard key={item.id} item={item} {...cardProps} />
                ))}
              </div>
            </CollapsibleSection>
            </div>
          )}

          {/* Saved */}
          {dashboardSaved.length > 0 && (
            <div className="mb-4">
              <div className="text-h3 font-semibold text-tertiary mb-3 flex items-center gap-2">
                <span>&#x1F516;</span> Saved
                <div className="flex-1" />
                <button
                  onClick={() => { setVerdictFilter("bookmarked"); setHomeMode("feed"); }}
                  className="bg-transparent border-none cursor-pointer text-cyan-400 text-caption font-semibold font-[inherit] p-0"
                >
                  Review Saved &rarr;
                </button>
              </div>
              <div className={cn(mobile ? "flex flex-col gap-4" : "grid grid-cols-3 gap-4")}>
                {dashboardSaved.map(item => (
                  <DashboardCard key={item.id} item={item} {...cardProps} />
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Chrome Extension CTA */}
      <a
        href="https://chromewebstore.google.com/detail/aegis-score/pnnpkepiojfpkppjpoimolkamflhbjhh"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 mt-4 px-4 py-3 bg-gradient-to-br from-cyan-500/[0.03] to-blue-600/[0.02] border border-cyan-500/[0.12] rounded-lg no-underline transition-normal"
      >
        <span className="text-xl shrink-0">&#x1F9E9;</span>
        <div className="flex-1 min-w-0">
          <div className="text-body-sm font-semibold text-cyan-400">
            Aegis Score for Chrome
          </div>
          <div className="text-caption text-muted-foreground mt-0.5">
            1-click V/C/L scores on any page &mdash; send articles to Aegis without leaving your browser
          </div>
        </div>
        <span className="text-caption text-cyan-400 font-semibold whitespace-nowrap shrink-0">
          Install &rarr;
        </span>
      </a>

      {/* Keyboard shortcut hint */}
      {!mobile && homeMode === "feed" && (
        <div className="text-center mt-3 text-tiny text-disabled">
          <span className="font-mono">J/K</span> navigate &middot; <span className="font-mono">V</span> validate &middot; <span className="font-mono">F</span> flag &middot; <span className="font-mono">{navigator?.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+K</span> commands
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} mobile={mobile} />
    </div>
  );
};
