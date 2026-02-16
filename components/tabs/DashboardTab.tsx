"use client";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard, deriveScoreTags } from "@/components/ui/ContentCard";
import { fonts, colors, space, type as t, radii, transitions, scoreGrade } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import { contentToCSV } from "@/lib/utils/csv";
import { FilterModeSelector } from "@/components/filtering/FilterModeSelector";
import { usePreferences } from "@/contexts/PreferenceContext";
import { getContext, hasEnoughData } from "@/lib/preferences/engine";
import { D2ANetworkMini } from "@/components/ui/D2ANetworkMini";
import { generateBriefing } from "@/lib/briefing/ranker";

function downloadFile(data: string, filename: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface DashboardTabProps {
  content: ContentItem[];
  mobile?: boolean;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  isLoading?: boolean;
  wotLoading?: boolean;
  onTabChange?: (tab: string) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ content, mobile, onValidate, onFlag, isLoading, wotLoading, onTabChange }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<"all" | "quality" | "slop" | "validated">("quality");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAllContent, setShowAllContent] = useState(false);
  const [homeMode, setHomeMode] = useState<"feed" | "dashboard">(() => {
    if (typeof window === "undefined") return "feed";
    try { return localStorage.getItem("aegis-home-mode") === "dashboard" ? "dashboard" : "feed"; }
    catch { return "feed"; }
  });
  const { profile } = usePreferences();

  useEffect(() => {
    try { localStorage.setItem("aegis-home-mode", homeMode); } catch { /* noop */ }
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

  // Dashboard-mode computations (skipped when in Feed mode)
  const dashboardTop3 = useMemo(() => {
    if (homeMode !== "dashboard") return [];
    const briefing = generateBriefing(content, profile);
    return briefing.priority.slice(0, 3);
  }, [content, profile, homeMode]);

  const dashboardTopicSpotlight = useMemo(() => {
    if (homeMode !== "dashboard") return [];
    const highTopics = Object.entries(profile.topicAffinities)
      .filter(([, v]) => v >= 0.3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([k]) => k);
    if (highTopics.length === 0) return [];
    const qualityItems = content.filter(c => c.verdict === "quality" && !c.flagged);
    return highTopics.map(topic => {
      const items = qualityItems.filter(c => c.topics?.includes(topic));
      if (items.length === 0) return null;
      return { topic, item: items.reduce((a, b) => b.scores.composite > a.scores.composite ? b : a) };
    }).filter(Boolean) as Array<{ topic: string; item: ContentItem }>;
  }, [content, profile, homeMode]);

  const dashboardValidated = useMemo(() => {
    if (homeMode !== "dashboard") return [];
    return content
      .filter(c => c.validated)
      .sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0))
      .slice(0, 5);
  }, [content, homeMode]);

  const dashboardActivity = useMemo(() => {
    if (homeMode !== "dashboard") return null;
    const now = Date.now();
    const dayMs = 86400000;
    const todayItems = content.filter(c => c.createdAt >= now - dayMs);
    const recentActions = content
      .filter(c => c.validated || c.flagged)
      .sort((a, b) => (b.validatedAt ?? b.createdAt) - (a.validatedAt ?? a.createdAt))
      .slice(0, 3);
    return {
      qualityCount: todayItems.filter(c => c.verdict === "quality").length,
      slopCount: todayItems.filter(c => c.verdict === "slop").length,
      totalEvaluated: todayItems.length,
      recentActions,
    };
  }, [content, homeMode]);

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

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      {/* Compact header */}
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
          <FilterModeSelector mobile={mobile} />
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

      {/* ═══ Feed Mode ═══ */}
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
                {agentContext.highAffinityTopics.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>Interests:</span>
                    {agentContext.highAffinityTopics.slice(0, 6).map(topic => (
                      <span key={topic} style={{
                        fontSize: t.caption.size,
                        padding: `1px ${space[2]}px`,
                        background: `${colors.cyan[400]}10`,
                        border: `1px solid ${colors.cyan[400]}20`,
                        borderRadius: radii.pill,
                        color: colors.cyan[400],
                      }}>{topic}</span>
                    ))}
                  </div>
                )}
                {agentContext.trustedAuthors.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>Trusted:</span>
                    {agentContext.trustedAuthors.slice(0, 4).map(author => (
                      <span key={author} style={{
                        fontSize: t.caption.size,
                        padding: `1px ${space[2]}px`,
                        background: `${colors.green[400]}10`,
                        border: `1px solid ${colors.green[400]}20`,
                        borderRadius: radii.pill,
                        color: colors.green[400],
                      }}>{author}</span>
                    ))}
                  </div>
                )}
                {agentContext.highAffinityTopics.length === 0 && agentContext.trustedAuthors.length === 0 && (
                  <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>
                    Learning your preferences... validate or flag more content.
                  </span>
                )}
              </div>
              <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2] }}>
                Threshold: {profile.calibration.qualityThreshold.toFixed(1)} &middot; Reviews: {profile.totalValidated + profile.totalFlagged}
              </div>
            </div>
          )}

          {/* D2A Network visualization */}
          <D2ANetworkMini mobile={mobile} />
        </>
      )}

      {/* ═══ Dashboard Mode ═══ */}
      {homeMode === "dashboard" && (
        <div style={{
          display: "grid",
          gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
          gap: space[4],
          marginTop: space[3],
        }}>
          {/* Today's Top 3 — Hero Cards */}
          <div style={{ gridColumn: mobile ? undefined : "1 / -1" }}>
            <div style={{
              fontSize: t.h3.size, fontWeight: t.h3.weight,
              color: colors.text.tertiary, marginBottom: space[3],
              display: "flex", alignItems: "center", gap: space[2],
            }}>
              <span>&#x2B50;</span> Today&#39;s Top 3
            </div>
            {dashboardTop3.length === 0 ? (
              <div style={{
                fontSize: t.bodySm.size, color: colors.text.disabled, textAlign: "center",
                padding: space[4], background: colors.bg.surface,
                border: `1px solid ${colors.border.default}`, borderRadius: radii.lg,
              }}>
                No quality items scored yet &#x2014; check back after your next ingestion cycle.
              </div>
            ) : (
              <div style={mobile
                ? { display: "flex", overflowX: "auto", gap: space[3], scrollSnapType: "x mandatory" as const, paddingBottom: space[2] }
                : { display: "grid", gridTemplateColumns: `repeat(${Math.min(dashboardTop3.length, 3)}, 1fr)`, gap: space[3] }
              }>
                {dashboardTop3.map((bi, i) => {
                  const item = bi.item;
                  const gr = scoreGrade(item.scores.composite);
                  const tags = deriveScoreTags(item);
                  const isExpanded = expanded === item.id;
                  return (
                    <div key={item.id} style={{
                      ...(mobile ? { minWidth: 280, flex: "0 0 85%", scrollSnapAlign: "start" as const } : {}),
                      animation: `slideUp .3s ease ${i * 0.08}s both`,
                    }}>
                      <div
                        onClick={() => setExpanded(isExpanded ? null : item.id)}
                        style={{
                          position: "relative",
                          background: colors.bg.surface,
                          border: `1px solid ${colors.border.default}`,
                          borderRadius: radii.lg,
                          padding: `${space[4]}px`,
                          cursor: "pointer",
                          transition: transitions.normal,
                        }}
                      >
                        {/* Rank badge — top left */}
                        <div style={{
                          position: "absolute", top: space[2], left: space[2],
                          width: 28, height: 28, borderRadius: "50%",
                          background: `linear-gradient(135deg, ${colors.blue[600]}, ${colors.purple[600]})`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: t.bodySm.size, fontWeight: 800, color: "#fff",
                          zIndex: 1,
                        }}>
                          {i + 1}
                        </div>

                        {/* Score tag — top right */}
                        {tags.length > 0 && (
                          <div style={{
                            position: "absolute", top: space[2], right: space[2],
                            fontSize: 9, fontWeight: 700, textTransform: "uppercase" as const,
                            letterSpacing: 1,
                            padding: `2px ${space[2]}px`, borderRadius: radii.sm,
                            background: `${tags[0].color}15`, color: tags[0].color,
                            border: `1px solid ${tags[0].color}25`,
                            zIndex: 1,
                          }}>
                            {tags[0].label}
                          </div>
                        )}

                        {/* Image / Grade fallback */}
                        <div style={{
                          width: "100%", aspectRatio: "16/9",
                          borderRadius: radii.md, overflow: "hidden",
                          marginBottom: space[3], marginTop: space[1],
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: item.imageUrl ? "transparent" : gr.bg,
                        }}>
                          {item.imageUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element -- hero card thumbnail */
                            <img
                              src={item.imageUrl}
                              alt=""
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              onError={(e) => {
                                const el = e.target as HTMLImageElement;
                                el.style.display = "none";
                                if (el.parentElement) {
                                  el.parentElement.style.background = gr.bg;
                                  const span = document.createElement("span");
                                  span.textContent = gr.grade;
                                  span.style.cssText = `font-size:48px;font-weight:800;color:${gr.color};font-family:${fonts.mono}`;
                                  el.parentElement.appendChild(span);
                                }
                              }}
                            />
                          ) : (
                            <span style={{ fontSize: 48, fontWeight: 800, color: gr.color, fontFamily: fonts.mono }}>
                              {gr.grade}
                            </span>
                          )}
                        </div>

                        {/* Title text */}
                        <div style={{
                          fontSize: t.body.size, fontWeight: 700,
                          color: colors.text.secondary,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical" as const,
                          lineHeight: 1.4,
                          marginBottom: space[1],
                        }}>
                          {item.text.slice(0, 120)}
                        </div>

                        {/* Reason summary */}
                        {item.reason && (
                          <div style={{
                            fontSize: t.caption.size, color: colors.text.muted,
                            overflow: "hidden", textOverflow: "ellipsis",
                            whiteSpace: "nowrap", marginBottom: space[2],
                          }}>
                            {item.reason.slice(0, 80)}
                          </div>
                        )}

                        {/* Topic pills */}
                        {item.topics && item.topics.length > 0 && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: space[2] }}>
                            {item.topics.slice(0, 3).map(tp => (
                              <span key={tp} style={{
                                fontSize: t.caption.size, padding: "2px 8px", borderRadius: radii.pill,
                                background: `${colors.cyan[400]}12`, color: colors.cyan[400], fontWeight: 600,
                              }}>{tp}</span>
                            ))}
                          </div>
                        )}

                        {/* Meta: author · source · timestamp */}
                        <div style={{
                          fontSize: t.caption.size, color: colors.text.disabled,
                        }}>
                          {item.author} &middot; {item.source} &middot; {item.timestamp}
                        </div>
                      </div>

                      {/* Expanded: full ContentCard inline */}
                      {isExpanded && (
                        <div style={{ marginTop: space[2] }}>
                          <ContentCard
                            item={item}
                            expanded
                            onToggle={() => setExpanded(null)}
                            onValidate={handleValidateWithFeedback}
                            onFlag={handleFlagWithFeedback}
                            mobile={mobile}
                          />
                        </div>
                      )}
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
                Validate more content so your agent can learn your interests.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
                {dashboardTopicSpotlight.map(({ topic, item }) => {
                  const gr = scoreGrade(item.scores.composite);
                  return (
                    <div key={topic} style={{
                      padding: `${space[2]}px ${space[3]}px`,
                      background: colors.bg.raised,
                      border: `1px solid ${colors.border.default}`,
                      borderLeft: `3px solid ${colors.cyan[400]}`,
                      borderRadius: radii.md,
                      cursor: "pointer",
                      transition: transitions.fast,
                    }}
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[1] }}>
                        <span style={{
                          fontSize: t.caption.size, padding: `1px ${space[2]}px`,
                          background: `${colors.cyan[400]}10`,
                          border: `1px solid ${colors.cyan[400]}20`,
                          borderRadius: radii.pill, color: colors.cyan[400], fontWeight: 600,
                        }}>{topic}</span>
                        <span style={{
                          fontSize: t.caption.size, fontWeight: 700, color: gr.color,
                          fontFamily: fonts.mono,
                        }}>{gr.grade}</span>
                      </div>
                      <div style={{
                        fontSize: t.bodySm.size, color: colors.text.tertiary,
                        overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {item.text.slice(0, 100)}
                      </div>
                      <div style={{
                        fontSize: t.caption.size, color: colors.text.disabled, marginTop: space[1],
                      }}>
                        {item.author} &middot; {item.source}
                      </div>
                      {expanded === item.id && (
                        <div style={{ marginTop: space[2] }}>
                          <ContentCard
                            item={item}
                            expanded
                            onToggle={() => setExpanded(null)}
                            onValidate={handleValidateWithFeedback}
                            onFlag={handleFlagWithFeedback}
                            mobile={mobile}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Saved for Later */}
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
              <span>&#x2713;</span> Saved for Later
            </div>
            {dashboardValidated.length === 0 ? (
              <div style={{ fontSize: t.bodySm.size, color: colors.text.disabled, textAlign: "center", padding: space[4] }}>
                No validated items yet. Validate quality content to save it here.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
                {dashboardValidated.map(item => (
                  <div key={item.id} style={{
                    display: "flex", alignItems: "center", gap: space[3],
                    padding: `${space[2]}px ${space[3]}px`,
                    background: colors.bg.raised,
                    border: `1px solid ${colors.border.default}`,
                    borderRadius: radii.md,
                  }}>
                    <span style={{ fontSize: t.bodySm.size, fontWeight: 700, color: colors.purple[400], fontFamily: fonts.mono }}>
                      {scoreGrade(item.scores.composite).grade}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: t.bodySm.size, color: colors.text.tertiary,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {item.text.slice(0, 80)}
                      </div>
                      <div style={{ fontSize: t.caption.size, color: colors.text.disabled }}>
                        {item.author} &middot; {item.source}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div style={{
            gridColumn: mobile ? undefined : "1 / -1",
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
              <span>&#x26A1;</span> Recent Activity
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

      {/* Export (below content list) */}
      {content.length > 0 && (
        <div style={{ display: "flex", gap: space[2], marginTop: space[4] }}>
          {([
            { label: "Export CSV", onClick: () => downloadFile(contentToCSV(content), `aegis-evaluations-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv") },
            { label: "Export JSON", onClick: () => {
              const data = content.map(c => ({
                id: c.id, author: c.author, source: c.source, verdict: c.verdict,
                scores: c.scores, vSignal: c.vSignal, cContext: c.cContext, lSlop: c.lSlop,
                topics: c.topics, text: c.text, reason: c.reason,
                createdAt: new Date(c.createdAt).toISOString(),
                validatedAt: c.validatedAt ? new Date(c.validatedAt).toISOString() : null,
                sourceUrl: c.sourceUrl,
              }));
              downloadFile(JSON.stringify(data, null, 2), `aegis-evaluations-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
            }},
          ] as const).map(btn => (
            <button key={btn.label} onClick={btn.onClick} style={exportBtnStyle}>
              &#x1F4E5; {btn.label}
            </button>
          ))}
        </div>
      )}
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
