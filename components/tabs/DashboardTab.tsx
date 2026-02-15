"use client";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard } from "@/components/ui/ContentCard";
import { fonts, colors, space, type as t, radii, transitions } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import { contentToCSV } from "@/lib/utils/csv";
import { FilterModeSelector } from "@/components/filtering/FilterModeSelector";
import { usePreferences } from "@/contexts/PreferenceContext";
import { getContext, hasEnoughData } from "@/lib/preferences/engine";
import { D2ANetworkMini } from "@/components/ui/D2ANetworkMini";

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
  const [verdictFilter, setVerdictFilter] = useState<"all" | "quality" | "slop">("quality");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAllContent, setShowAllContent] = useState(false);
  const { profile } = usePreferences();

  const { todayContent, todayQual, todaySlop, totalSlop, uniqueSources, availableSources, dailyQuality, dailySlop } = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = now - dayMs;

    const todayContent = content.filter(c => c.createdAt >= todayStart);
    const todayQual = todayContent.filter(c => c.verdict === "quality");
    const todaySlop = todayContent.filter(c => c.verdict === "slop");
    const totalSlop = content.filter(c => c.verdict === "slop").length;
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
    return { todayContent, todayQual, todaySlop, totalSlop, uniqueSources, availableSources, dailyQuality, dailySlop };
  }, [content]);

  const filteredContent = useMemo(() => {
    let items = content;
    if (verdictFilter !== "all") items = items.filter(c => c.verdict === verdictFilter);
    if (sourceFilter !== "all") items = items.filter(c => c.source === sourceFilter);
    return items;
  }, [content, verdictFilter, sourceFilter]);

  const hasActiveFilter = verdictFilter !== "all" || sourceFilter !== "all";

  const agentContext = useMemo(() => {
    if (!hasEnoughData(profile)) return null;
    return getContext(profile);
  }, [profile]);

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
          <FilterModeSelector mobile={mobile} />
          {wotLoading && (
            <span style={{ fontSize: t.caption.size, color: colors.text.disabled, animation: "pulse 2s infinite" }}>
              &#x1F310; WoT...
            </span>
          )}
        </div>
      </div>

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

      {/* Slop defense counter */}
      {totalSlop > 0 && (
        <div style={{
          marginBottom: space[3],
          padding: `${space[2]}px ${space[4]}px`,
          background: "rgba(251,146,60,0.04)",
          border: `1px solid rgba(251,146,60,0.12)`,
          borderRadius: radii.md,
          fontSize: t.bodySm.size,
          color: colors.text.muted,
          textAlign: "center",
        }}>
          <span style={{ fontWeight: 700, color: colors.orange[400], fontFamily: fonts.mono }}>{totalSlop}</span>
          {" "}slop items burned total &mdash; you never saw any of them.
        </div>
      )}

      {/* Content filters */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space[3], flexWrap: "wrap", gap: space[2] }}>
        <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>
          Filtered Signal {hasActiveFilter && <span style={{ fontSize: t.bodySm.size, color: colors.text.disabled }}>({filteredContent.length})</span>}
        </div>
        <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
          {(["quality", "all", "slop"] as const).map(v => (
            <button
              key={v}
              onClick={() => setVerdictFilter(v)}
              style={{
                padding: `${space[1]}px ${space[3]}px`,
                background: verdictFilter === v ? (v === "quality" ? colors.green.bg : v === "slop" ? colors.red.bg : colors.bg.raised) : "transparent",
                border: `1px solid ${verdictFilter === v ? (v === "quality" ? colors.green.border : v === "slop" ? colors.red.border : colors.border.emphasis) : colors.border.default}`,
                borderRadius: radii.pill,
                color: verdictFilter === v ? (v === "quality" ? colors.green[400] : v === "slop" ? colors.red[400] : colors.text.secondary) : colors.text.disabled,
                fontSize: t.caption.size,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: transitions.fast,
                textTransform: "capitalize",
              }}
            >
              {v}
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

      {/* Signal feedback loop message */}
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
                createdAt: new Date(c.createdAt).toISOString(), sourceUrl: c.sourceUrl,
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
