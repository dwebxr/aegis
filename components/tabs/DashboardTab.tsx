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
  applyLatestFilter,
  computeDashboardTop3,
  computeTopicSpotlight,
  computeDashboardSaved,
  computeUnreviewedQueue,
  type VerdictFilter,
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
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
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

function AgentKnowledgePills({ agentContext, profile, recentActions }: {
  agentContext: { highAffinityTopics: string[]; trustedAuthors: string[] };
  profile: { calibration: { qualityThreshold: number }; totalValidated: number; totalFlagged: number };
  recentActions?: ContentItem[];
}) {
  const totalReviews = profile.totalValidated + profile.totalFlagged;
  const nextMilestone = totalReviews < 10 ? 10 : totalReviews < 25 ? 25 : totalReviews < 50 ? 50 : totalReviews < 100 ? 100 : Math.ceil((totalReviews + 1) / 50) * 50;
  const remaining = nextMilestone - totalReviews;

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
      {recentActions && recentActions.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          <span className="text-tiny text-disabled">Recent learning:</span>
          {recentActions.slice(0, 2).map(a => (
            <div key={a.id} className="text-tiny text-muted-foreground truncate">
              {a.validated ? "\u2713" : "\u2717"} {a.topics?.[0] ?? a.author ?? "item"} &middot; {a.author !== "You" ? a.author : ""}
            </div>
          ))}
        </div>
      )}
      <div className="text-tiny text-disabled mt-2">
        Threshold: {profile.calibration.qualityThreshold.toFixed(1)} &middot; Reviews: {totalReviews}
        {remaining > 0 && remaining <= 10 && (
          <span className="text-purple-400"> &middot; {remaining} more to next milestone</span>
        )}
      </div>
    </>
  );
}

const EMPTY_SECTIONS = { filteredDiscoveries: [] as SerendipityItem[], unreviewedQueue: [] as ContentItem[], dashboardSaved: [] as ContentItem[] };

const CHROME_CTA_URL = "https://chromewebstore.google.com/detail/aegis-score/pnnpkepiojfpkppjpoimolkamflhbjhh";

/** Items per infinite-scroll batch. No debounce needed — setVisibleCount is idempotent. */
const BATCH_SIZE = 40;

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
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("quality");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const moreFiltersRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
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
  const { profile, addFilterRule, bookmarkItem, unbookmarkItem } = usePreferences();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("aegis-home-mode", homeMode); } catch (e) { console.debug("[dashboard] localStorage write failed:", e); }
  }, [homeMode]);

  const { todayContent, todayQual, todaySlop, yesterdayQual, yesterdaySlop, yesterdayEval, yesterdaySources, todaySources, uniqueSources, availableSources, dailyQuality, dailySlop, streak, streakAtRisk } = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = now - dayMs;
    const yesterdayStart = now - 2 * dayMs;

    const todayContent = content.filter(c => c.createdAt >= todayStart);
    const todayQual = todayContent.filter(c => c.verdict === "quality");
    const todaySlop = todayContent.filter(c => c.verdict === "slop");
    const yesterdayContent = content.filter(c => c.createdAt >= yesterdayStart && c.createdAt < todayStart);
    const yesterdayQual = yesterdayContent.filter(c => c.verdict === "quality").length;
    const yesterdaySlop = yesterdayContent.filter(c => c.verdict === "slop").length;
    const yesterdayEval = yesterdayContent.length;
    const yesterdaySources = new Set(yesterdayContent.map(c => c.source)).size;
    const todaySources = new Set(todayContent.map(c => c.source)).size;
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

    // Reading streak: count consecutive days where user validated or flagged at least 1 item
    const reviewedItems = content.filter(c => c.validated || c.flagged);
    const todayHasReview = reviewedItems.some(c => (c.validatedAt ?? c.createdAt) >= todayStart);
    let streak = todayHasReview ? 1 : 0;
    for (let d = 1; d <= 30; d++) {
      const dStart = now - (d + 1) * dayMs;
      const dEnd = now - d * dayMs;
      const hasReview = reviewedItems.some(c => {
        const ts = c.validatedAt ?? c.createdAt;
        return ts >= dStart && ts < dEnd;
      });
      if (hasReview) streak++;
      else break;
    }
    // streakAtRisk: user had a streak yesterday but hasn't reviewed today
    const streakAtRisk = !todayHasReview && streak > 0;

    return { todayContent, todayQual, todaySlop, yesterdayQual, yesterdaySlop, yesterdayEval, yesterdaySources, todaySources, uniqueSources, availableSources, dailyQuality, dailySlop, streak, streakAtRisk };
  }, [content]);

  useEffect(() => {
    setExpanded(null);
    setVisibleCount(BATCH_SIZE);
  }, [verdictFilter, sourceFilter, topicFilter]);

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

  const bookmarkedIds = useMemo(() => profile.bookmarkedIds ?? [], [profile.bookmarkedIds]);

  const filteredContent = useMemo(() => {
    let items = deduplicateItems(applyLatestFilter(content, verdictFilter, sourceFilter, bookmarkedIds));
    if (topicFilter !== "all") {
      const t = topicFilter.toLowerCase();
      items = items.filter(c => c.topics?.some(tag => tag.toLowerCase() === t));
    }
    return items;
  }, [content, verdictFilter, sourceFilter, topicFilter, bookmarkedIds]);

  const { isExpanded: isSectionExpanded, toggle: toggleSection, observeRef: sectionRef } = useAutoReveal();

  const hasActiveFilter = (verdictFilter !== "all" && verdictFilter !== "quality") || sourceFilter !== "all" || topicFilter !== "all";
  const moreFiltersActive = verdictFilter === "slop" || sourceFilter !== "all";

  const agentContext = useMemo(() => {
    if (!hasEnoughData(profile)) return null;
    return getContext(profile);
  }, [profile]);

  const showSidebar = homeMode === "feed" && !mobile;

  const topSources = useMemo(() => {
    if (!showSidebar) return [];
    const stats = new Map<string, { total: number; quality: number; platform: string | undefined }>();
    for (const c of content) {
      const filterKey = c.source;
      const s = stats.get(filterKey) ?? { total: 0, quality: 0, platform: undefined };
      s.total++;
      if (c.verdict === "quality") s.quality++;
      if (c.platform && !s.platform) s.platform = c.platform;
      stats.set(filterKey, s);
    }
    return Array.from(stats.entries())
      .map(([filterKey, s]) => ({
        filterKey,
        displayName: s.platform ?? filterKey,
        count: s.total,
        qualityRate: s.total > 0 ? s.quality / s.total : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [content, showSidebar]);

  const [prevAffinities] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("aegis-prev-affinities");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  const topTopics = useMemo(() => {
    if (!showSidebar) return [];
    const hasPrev = Object.keys(prevAffinities).length > 0;
    const entries = Object.entries(profile.topicAffinities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, score]) => {
        const prevScore = prevAffinities[topic];
        const isNew = hasPrev && prevScore === undefined && score >= 0.3;
        const direction: "up" | "down" | "stable" =
          !hasPrev || prevScore === undefined ? "stable" :
          score - prevScore > 0.05 ? "up" :
          score - prevScore < -0.05 ? "down" : "stable";
        return { topic, score, direction, isNew };
      });
    return entries;
  }, [profile.topicAffinities, showSidebar, prevAffinities]);

  useEffect(() => {
    if (Object.keys(profile.topicAffinities).length > 0) {
      try { localStorage.setItem("aegis-prev-affinities", JSON.stringify(profile.topicAffinities)); } catch {}
    }
  }, [profile.topicAffinities]);

  const metricsItems = [
    { icon: "\u{1F6E1}", value: todayQual.length, delta: todayQual.length - yesterdayQual, label: "quality", colorClass: "text-cyan-400" },
    { icon: "\u{1F525}", value: todaySlop.length, delta: todaySlop.length - yesterdaySlop, label: "burned", colorClass: "text-orange-400" },
    { icon: "\u26A1", value: todayContent.length, delta: todayContent.length - yesterdayEval, label: "eval", colorClass: "text-purple-400" },
    { icon: "\u{1F4E1}", value: uniqueSources.size, delta: todaySources - yesterdaySources, label: "sources", colorClass: "text-sky-400" },
  ];

  const sidebarUnreviewed = useMemo(() => {
    if (!showSidebar) return [];
    return computeUnreviewedQueue(content, new Set()).slice(0, 3);
  }, [content, showSidebar]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("aegis-sidebar-collapsed");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  const toggleSidebarSection = useCallback((key: string) => {
    setSidebarCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem("aegis-sidebar-collapsed", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

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

  const bookmarkSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);

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

  const visibleItems = useMemo(
    () => filteredContent.slice(0, visibleCount),
    [filteredContent, visibleCount],
  );

  const hasMore = visibleItems.length < filteredContent.length;
  const remainingCount = filteredContent.length - visibleItems.length;

  const loadMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + BATCH_SIZE, filteredContent.length));
  }, [filteredContent.length]);

  const sentinelRef = useInfiniteScroll(loadMore);

  const feedItemIds = useMemo(
    () => visibleItems.map(c => c.id),
    [visibleItems],
  );

  const { focusedId } = useKeyboardNav({
    items: feedItemIds,
    expandedId: expanded,
    onExpand: setExpanded,
    onValidate: handleValidateWithFeedback,
    onFlag: handleFlagWithFeedback,
    onOpenPalette: () => setPaletteOpen(true),
    enabled: !mobile && homeMode === "feed",
  });

  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingScrollId) return;
    const el = document.getElementById(`card-${pendingScrollId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setExpanded(pendingScrollId);
      setPendingScrollId(null);
    }
  }, [pendingScrollId, visibleCount]);

  const scrollToItem = useCallback((itemId: string) => {
    const el = document.getElementById(`card-${itemId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setExpanded(itemId);
      return;
    }
    // Item not rendered yet — find its position in filteredContent and expand batch
    const idx = filteredContent.findIndex(c => c.id === itemId);
    if (idx >= 0) {
      setVisibleCount(Math.min(idx + BATCH_SIZE, filteredContent.length));
      setPendingScrollId(itemId);
    }
  }, [filteredContent]);

  const recentLearningActions = useMemo(() =>
    content
      .filter(c => c.validated || c.flagged)
      .sort((a, b) => (b.validatedAt ?? b.createdAt) - (a.validatedAt ?? a.createdAt))
      .slice(0, 2),
    [content],
  );

  const agentKnowsCard = agentContext && (
    <div
      className={cn(
        "px-4 py-3 bg-card rounded-md transition-all duration-500",
        agentKnowsHighlight
          ? "border border-purple-500/30 shadow-[0_0_12px_rgba(139,92,246,0.1)]"
          : "border border-border"
      )}
    >
      <div className="text-body-sm font-semibold text-tertiary mb-2">
        Your Agent Knows
      </div>
      <AgentKnowledgePills agentContext={agentContext} profile={profile} recentActions={recentLearningActions} />
    </div>
  );

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const cmds: PaletteCommand[] = [
      { label: "Go to Feed", action: () => setHomeMode("feed") },
      { label: "Go to Dashboard", action: () => setHomeMode("dashboard") },
      { label: "Go to Analytics", action: () => onTabChange?.("analytics") },
      { label: "Go to Settings", action: () => onTabChange?.("settings") },
      { label: "Go to Sources", action: () => onTabChange?.("sources") },
      { label: "Filter: Quality", action: () => setVerdictFilter("quality") },
      { label: "Filter: Slop", action: () => setVerdictFilter("slop") },
      { label: "Filter: All", action: () => setVerdictFilter("all") },
      { label: "Filter: Validated", action: () => setVerdictFilter("validated") },
      { label: "Filter: Saved", action: () => setVerdictFilter("bookmarked") },
      { label: "Export CSV", action: () => exportContentCSV(content) },
      { label: "Export JSON", action: () => exportContentJSON(content) },
    ];
    if (topicFilter !== "all") {
      cmds.push({ label: `Clear topic filter: ${topicFilter}`, action: () => setTopicFilter("all") });
    }
    for (const t of topTopics) {
      cmds.push({ label: `Topic: ${t.topic}`, action: () => setTopicFilter(topicFilter === t.topic ? "all" : t.topic) });
    }
    return cmds;
  }, [onTabChange, content, topTopics, topicFilter]);

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

      {feedbackMsg && (
        <div
          key={feedbackMsg.key}
          className="my-2 px-4 py-2 bg-purple-500/[0.06] border border-purple-500/15 rounded-md text-body-sm text-purple-400 font-semibold text-center animate-fade-in"
        >
          &#x1F4E1; Agent learned: {feedbackMsg.text}
        </div>
      )}

      {homeMode === "feed" && (
        <div className={cn(!mobile && "flex gap-6")}>
          {/* ── Center column: filters + content ── */}
          <div className="flex-1 min-w-0">
            {/* Metrics bar — mobile only (desktop moves to sidebar) */}
            {mobile && (
              <div data-testid="aegis-metrics-bar" className="flex flex-wrap items-center mb-3 px-4 py-2 bg-card border border-border rounded-md gap-3">
                <div className="flex flex-wrap gap-3 flex-1">
                  {metricsItems.map(m => (
                    <span key={m.label} className="flex items-center gap-1 text-body-sm text-muted-foreground">
                      <span>{m.icon}</span>
                      <span className={cn("font-bold font-mono", m.colorClass)}>{m.value}</span>
                      <span>{m.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="text-h3 font-semibold text-tertiary">
                Filtered Signal {hasActiveFilter && <span data-testid="aegis-filter-count" className="text-body-sm text-disabled">({filteredContent.length})</span>}
              </div>
              <div className="flex gap-1 flex-wrap items-center">
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

                {topicFilter !== "all" && (
                  <button
                    data-testid="aegis-filter-topic-active"
                    onClick={() => setTopicFilter("all")}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-caption font-semibold cursor-pointer font-[inherit] transition-fast border bg-cyan-500/[0.05] border-cyan-500/[0.15] text-cyan-400"
                  >
                    {topicFilter} <span className="text-cyan-400/60">&times;</span>
                  </button>
                )}

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

                      <div className="h-px bg-border my-2" />
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
                {visibleItems.map((item, i) => (
                  <React.Fragment key={item.id}>
                    {i > 0 && i % BATCH_SIZE === 0 && (
                      <div data-testid="aegis-batch-separator" className="flex items-center gap-3 py-2">
                        <div className="flex-1 border-t border-border" />
                        <span className="text-caption text-disabled whitespace-nowrap">
                          Showing {i} of {filteredContent.length} items
                        </span>
                        <div className="flex-1 border-t border-border" />
                      </div>
                    )}
                    <div style={i < BATCH_SIZE ? { animation: `slideUp .2s ease ${i * 0.03}s both` } : undefined}>
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
                  </React.Fragment>
                ))}
                {hasMore && <div ref={sentinelRef} data-testid="aegis-scroll-sentinel" className="h-1" />}
                {hasMore && (
                  <button
                    data-testid="aegis-load-remaining"
                    onClick={loadMore}
                    className="w-full px-4 py-3 bg-card border border-border rounded-md text-muted-foreground text-body-sm font-semibold cursor-pointer font-[inherit] transition-normal mt-2"
                  >
                    Load remaining {remainingCount} items
                  </button>
                )}
                {!hasMore && filteredContent.length > BATCH_SIZE && (
                  <div className="flex items-center gap-3 py-3 mt-1">
                    <div className="flex-1 border-t border-border" />
                    <span className="text-caption text-disabled whitespace-nowrap">
                      Showing {filteredContent.length} of {filteredContent.length} items
                    </span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                )}
              </>
            )}

            {/* Agent Knowledge — mobile inline */}
            {mobile && agentKnowsCard && <div className="mt-4">{agentKnowsCard}</div>}

            <D2ANetworkMini mobile={mobile} />

            {/* Keyboard hint — inside center column so it aligns with content, not sidebar */}
            {!mobile && (
              <div className="text-center mt-3 text-tiny text-disabled">
                <span className="font-mono">J/K</span> navigate &middot; <span className="font-mono">V</span> validate &middot; <span className="font-mono">F</span> flag &middot; <span className="font-mono">{navigator?.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+K</span> commands
              </div>
            )}
          </div>

          {/* ── Right sidebar — desktop only ── */}
          {showSidebar && (
            <aside data-testid="aegis-feed-sidebar" className="w-[280px] shrink-0 sticky top-4 self-start flex flex-col gap-3 max-h-[calc(100vh-2rem)] overflow-y-auto scrollbar-none">
              {/* ── Metrics bar ── */}
              <div data-testid="aegis-metrics-bar" className="px-4 py-3 bg-card border border-border rounded-md">
                <div className="flex flex-col gap-2">
                  {metricsItems.map(m => (
                    <span key={m.label} className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
                      <span>{m.icon}</span>
                      <span className={cn("font-bold font-mono", m.colorClass)}>{m.value}</span>
                      <span>{m.label}</span>
                      {m.delta !== 0 && (
                        <span className={cn("text-tiny font-mono", m.delta > 0 ? "text-emerald-400" : "text-red-400")}>
                          {m.delta > 0 ? "+" : ""}{m.delta}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <div className="flex gap-3 items-center mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1 flex-1">
                    <div className="w-[50px]">
                      <MiniChart data={dailyQuality} color={colors.cyan[400]} h={18} />
                    </div>
                    <span className="text-tiny text-cyan-400 font-mono">
                      {dailyQuality[dailyQuality.length - 1]}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-1">
                    <div className="w-[50px]">
                      <MiniChart data={dailySlop} color={colors.orange[500]} h={18} />
                    </div>
                    <span className="text-tiny text-orange-500 font-mono">
                      {dailySlop[dailySlop.length - 1]}
                    </span>
                  </div>
                </div>
                {dailyQuality[dailyQuality.length - 1] >= 70 && todayContent.length >= 5 && (
                  <div className="text-tiny text-emerald-400 mt-2 text-center font-semibold">
                    High quality day!
                  </div>
                )}
              </div>

              {/* ── Reading Streak ── */}
              {streak > 0 && (
                <div className="px-4 py-3 bg-card border border-border rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-body-sm font-semibold text-tertiary">Reading Streak</span>
                    <span className="text-body-sm font-bold text-orange-400 font-mono">{streak}d</span>
                  </div>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 7 }, (_, i) => {
                      const active = i < Math.min(streak, 7);
                      return (
                        <div
                          key={i}
                          className={cn(
                            "h-1.5 flex-1 rounded-full transition-all",
                            active ? "bg-orange-400" : "bg-border"
                          )}
                        />
                      );
                    })}
                  </div>
                  {streakAtRisk && (
                    <div className="text-tiny text-orange-400/70 mt-1.5 text-center">
                      Review content today to keep your streak!
                    </div>
                  )}
                </div>
              )}

              {/* ── Unreviewed Queue ── */}
              {!sidebarCollapsed["unreviewed"] && sidebarUnreviewed.length > 0 && (
                <div className="px-4 py-3 bg-card border border-border rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-body-sm font-semibold text-tertiary">Needs Review</span>
                    <button
                      onClick={() => toggleSidebarSection("unreviewed")}
                      className="text-tiny text-disabled bg-transparent border-none cursor-pointer font-[inherit]"
                    >&#x25BC;</button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {sidebarUnreviewed.map(item => (
                      <button
                        key={item.id}
                        onClick={() => scrollToItem(item.id)}
                        className="flex flex-col gap-0.5 text-left bg-transparent border-none cursor-pointer font-[inherit] p-0 group"
                      >
                        <div className="text-caption text-secondary-foreground font-medium truncate group-hover:text-cyan-400 transition-fast">
                          {item.text.slice(0, 60)}{item.text.length > 60 ? "..." : ""}
                        </div>
                        <div className="flex items-center gap-1.5 text-tiny text-disabled">
                          <span>{item.source}</span>
                          <span className="font-mono text-cyan-400">{item.scores.composite.toFixed(1)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {sidebarCollapsed["unreviewed"] && sidebarUnreviewed.length > 0 && (
                <button
                  onClick={() => toggleSidebarSection("unreviewed")}
                  className="px-4 py-2 bg-card border border-border rounded-md text-body-sm font-semibold text-tertiary flex items-center justify-between cursor-pointer font-[inherit]"
                >
                  <span>Needs Review</span>
                  <span className="flex items-center gap-1">
                    <span className="text-caption text-muted-foreground bg-navy-lighter px-2 py-0.5 rounded-sm">{sidebarUnreviewed.length}</span>
                    <span className="text-tiny text-disabled">&#x25B6;</span>
                  </span>
                </button>
              )}

              {/* ── Agent Knowledge ── */}
              {agentKnowsCard}

              {/* ── Top Sources (interactive) ── */}
              {topSources.length > 0 && !sidebarCollapsed["sources"] && (
                <div className="px-4 py-3 bg-card border border-border rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-body-sm font-semibold text-tertiary">Top Sources</span>
                    <button
                      onClick={() => toggleSidebarSection("sources")}
                      className="text-tiny text-disabled bg-transparent border-none cursor-pointer font-[inherit]"
                    >&#x25BC;</button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {topSources.map((s, i) => (
                      <button
                        key={s.filterKey}
                        onClick={() => setSourceFilter(sourceFilter === s.filterKey ? "all" : s.filterKey)}
                        className={cn(
                          "flex items-center gap-2 text-body-sm bg-transparent border-none cursor-pointer font-[inherit] p-0 text-left group transition-fast",
                          sourceFilter === s.filterKey && "text-cyan-400"
                        )}
                      >
                        <span className="text-tiny text-disabled font-mono w-4 text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className={cn(
                            "font-medium truncate transition-fast",
                            sourceFilter === s.filterKey ? "text-cyan-400" : "text-secondary-foreground group-hover:text-cyan-400"
                          )}>
                            {s.displayName}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-400/60 rounded-full"
                                style={{ width: `${Math.round(s.qualityRate * 100)}%` }}
                              />
                            </div>
                            <span className="text-tiny text-disabled font-mono">{Math.round(s.qualityRate * 100)}%</span>
                          </div>
                        </div>
                        <span className="text-tiny text-disabled font-mono">{s.count}</span>
                      </button>
                    ))}
                  </div>
                  {sourceFilter !== "all" && (
                    <button
                      onClick={() => setSourceFilter("all")}
                      className="mt-2 text-caption text-cyan-400 bg-transparent border-none cursor-pointer font-[inherit] font-semibold"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              )}
              {topSources.length > 0 && sidebarCollapsed["sources"] && (
                <button
                  onClick={() => toggleSidebarSection("sources")}
                  className="px-4 py-2 bg-card border border-border rounded-md text-body-sm font-semibold text-tertiary flex items-center justify-between cursor-pointer font-[inherit]"
                >
                  <span>Top Sources</span>
                  <span className="text-tiny text-disabled">&#x25B6;</span>
                </button>
              )}

              {/* ── Top Topics (with trends) ── */}
              {topTopics.length > 0 && !sidebarCollapsed["topics"] && (
                <div className="px-4 py-3 bg-card border border-border rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-body-sm font-semibold text-tertiary">Top Topics</span>
                    <button
                      onClick={() => toggleSidebarSection("topics")}
                      className="text-tiny text-disabled bg-transparent border-none cursor-pointer font-[inherit]"
                    >&#x25BC;</button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {topTopics.map((t, i) => (
                      <button
                        key={t.topic}
                        onClick={() => setTopicFilter(topicFilter === t.topic ? "all" : t.topic)}
                        className={cn(
                          "flex items-center gap-2 text-body-sm bg-transparent border-none cursor-pointer font-[inherit] p-0 text-left group transition-fast",
                          topicFilter === t.topic && "text-cyan-400"
                        )}
                      >
                        <span className="text-tiny text-disabled font-mono w-4 text-right">{i + 1}</span>
                        <span className={cn(
                          "font-medium truncate flex-1 transition-fast",
                          topicFilter === t.topic ? "text-cyan-300" : "text-cyan-400 group-hover:text-cyan-300"
                        )}>
                          {t.topic}
                          {t.isNew && (
                            <span className="ml-1 text-tiny px-1.5 py-px bg-purple-500/[0.15] border border-purple-500/20 rounded-full text-purple-400 font-bold">
                              NEW
                            </span>
                          )}
                        </span>
                        <span className={cn(
                          "text-tiny font-mono",
                          t.direction === "up" ? "text-emerald-400" :
                          t.direction === "down" ? "text-red-400" :
                          "text-disabled"
                        )}>
                          {t.direction === "up" ? "\u2191" : t.direction === "down" ? "\u2193" : ""}{t.score.toFixed(1)}
                        </span>
                      </button>
                    ))}
                    {topicFilter !== "all" && (
                      <button
                        onClick={() => setTopicFilter("all")}
                        className="mt-1 text-caption text-cyan-400 bg-transparent border-none cursor-pointer font-[inherit] font-semibold"
                      >
                        Clear topic filter
                      </button>
                    )}
                  </div>
                </div>
              )}
              {topTopics.length > 0 && sidebarCollapsed["topics"] && (
                <button
                  onClick={() => toggleSidebarSection("topics")}
                  className="px-4 py-2 bg-card border border-border rounded-md text-body-sm font-semibold text-tertiary flex items-center justify-between cursor-pointer font-[inherit]"
                >
                  <span>Top Topics</span>
                  <span className="text-tiny text-disabled">&#x25B6;</span>
                </button>
              )}

              {/* ── Chrome Extension CTA ── */}
              <a
                href={CHROME_CTA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 bg-gradient-to-br from-cyan-500/[0.03] to-blue-600/[0.02] border border-cyan-500/[0.12] rounded-lg no-underline transition-normal"
              >
                <span className="text-xl shrink-0">&#x1F9E9;</span>
                <div className="flex-1 min-w-0">
                  <div className="text-body-sm font-semibold text-cyan-400">
                    Aegis Score for Chrome
                  </div>
                  <div className="text-caption text-muted-foreground mt-0.5">
                    1-click V/C/L scores on any page
                  </div>
                </div>
              </a>
            </aside>
          )}
        </div>
      )}

      {homeMode === "dashboard" && (
        <div className="mt-3">
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

      {/* Desktop feed has CTA in sidebar; other modes show it here */}
      {(homeMode === "dashboard" || mobile) && (
        <a
          href={CHROME_CTA_URL}
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
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} mobile={mobile} />
    </div>
  );
};
