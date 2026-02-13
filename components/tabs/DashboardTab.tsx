"use client";
import React, { useState, useMemo } from "react";
import { ShieldIcon, FireIcon, ZapIcon, RSSIcon } from "@/components/icons";
import { StatCard } from "@/components/ui/StatCard";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard } from "@/components/ui/ContentCard";
import { fonts, colors, space, type as t, radii, transitions } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import { contentToCSV } from "@/lib/utils/csv";
import { FilterModeSelector } from "@/components/filtering/FilterModeSelector";

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
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ content, mobile, onValidate, onFlag, isLoading, wotLoading }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<"all" | "quality" | "slop">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAllContent, setShowAllContent] = useState(false);

  const { todayContent, todayQual, todaySlop, uniqueSources, availableSources, dailyQuality, dailySlop, dayLabels } = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = now - dayMs;
    const dayNames = ["S", "M", "T", "W", "T", "F", "S"];

    const todayContent = content.filter(c => c.createdAt >= todayStart);
    const todayQual = todayContent.filter(c => c.verdict === "quality");
    const todaySlop = todayContent.filter(c => c.verdict === "slop");
    const uniqueSources = new Set(content.map(c => c.source));
    const availableSources = Array.from(uniqueSources).sort();

    const dailyQuality: number[] = [];
    const dailySlop: number[] = [];
    const dayLabels: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - (i + 1) * dayMs;
      const dayEnd = now - i * dayMs;
      const dayItems = content.filter(c => c.createdAt >= dayStart && c.createdAt < dayEnd);
      const dayQual = dayItems.filter(c => c.verdict === "quality").length;
      const dayTotal = dayItems.length;
      dailyQuality.push(dayTotal > 0 ? Math.round((dayQual / dayTotal) * 100) : 0);
      dailySlop.push(dayItems.filter(c => c.verdict === "slop").length);
      dayLabels.push(dayNames[new Date(dayEnd).getDay()]);
    }
    return { todayContent, todayQual, todaySlop, uniqueSources, availableSources, dailyQuality, dailySlop, dayLabels };
  }, [content]);

  const filteredContent = useMemo(() => {
    let items = content;
    if (verdictFilter !== "all") items = items.filter(c => c.verdict === verdictFilter);
    if (sourceFilter !== "all") items = items.filter(c => c.source === sourceFilter);
    return items;
  }, [content, verdictFilter, sourceFilter]);

  const hasActiveFilter = verdictFilter !== "all" || sourceFilter !== "all";

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      {/* Hero */}
      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "5fr 7fr",
        gap: mobile ? space[6] : space[8],
        marginBottom: mobile ? space[12] : space[16],
        alignItems: "start",
      }}>
        <div>
          <h1 style={{
            fontSize: mobile ? t.display.mobileSz : t.display.size,
            fontWeight: t.display.weight,
            lineHeight: t.display.lineHeight,
            letterSpacing: t.display.letterSpacing,
            color: colors.text.primary,
            margin: 0,
          }}>
            Aegis Dashboard
          </h1>
          <p style={{
            fontSize: t.bodySm.size,
            lineHeight: t.body.lineHeight,
            color: colors.text.muted,
            marginTop: space[4],
          }}>
            Content quality filter that learns your taste, curates a zero-noise briefing, publishes signals to Nostr, and exchanges content with other agents over an encrypted D2A protocol.
          </p>
          <div style={{ marginTop: space[4] }}>
            <FilterModeSelector mobile={mobile} />
          </div>
          {wotLoading && (
            <div style={{
              marginTop: space[2],
              fontSize: t.caption.size,
              color: colors.text.disabled,
              display: "flex",
              alignItems: "center",
              gap: space[2],
            }}>
              <span style={{ animation: "pulse 2s infinite" }}>&#x1F310;</span>
              Building Web of Trust graph...
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: mobile ? space[3] : space[4] }}>
          <StatCard icon={<ShieldIcon s={16} />} label="Quality" value={todayQual.length} sub={`of ${todayContent.length} in last 24h`} color={colors.cyan[400]} mobile={mobile} />
          <StatCard icon={<FireIcon s={16} />} label="Burned" value={todaySlop.length} sub="slop filtered in last 24h" color={colors.orange[400]} mobile={mobile} />
          <StatCard icon={<ZapIcon s={16} />} label="Evaluated" value={todayContent.length} sub="items in last 24h" color={colors.purple[400]} mobile={mobile} />
          <StatCard icon={<RSSIcon s={16} />} label="Sources" value={uniqueSources.size} sub="active feeds" color={colors.sky[400]} mobile={mobile} />
        </div>
      </div>

      {/* Charts */}
      <div style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
        gap: mobile ? space[3] : space[4],
        marginBottom: mobile ? space[12] : space[16],
      }}>
        {[
          { title: "Filter Accuracy", d: dailyQuality, c: colors.cyan[400], unit: "%" },
          { title: "Slop Volume", d: dailySlop, c: colors.orange[500], unit: "items" },
        ].map(ch => (
          <div key={ch.title} style={{
            background: colors.bg.surface,
            border: `1px solid ${colors.border.default}`,
            borderRadius: radii.lg,
            padding: mobile ? space[4] : space[5],
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginBottom: space[3],
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: space[2] }}>
                <span style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>
                  {ch.title}
                </span>
                <span style={{ fontSize: t.h2.size, fontWeight: 700, color: ch.c, fontFamily: fonts.mono }}>
                  {ch.d.length > 0 ? ch.d[ch.d.length - 1] : 0}{ch.unit === "%" ? "%" : ""}
                </span>
              </div>
              <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>
                7-day {ch.unit === "%" ? "(%)" : "(count)"}
              </span>
            </div>
            <MiniChart data={ch.d} color={ch.c} h={mobile ? 40 : 50} />
            <div style={{
              display: "flex", justifyContent: "space-between",
              fontSize: t.tiny.size, color: colors.text.disabled, marginTop: 2,
            }}>
              <span>{Math.min(...ch.d)}{ch.unit === "%" ? "%" : ""}</span>
              <span>{Math.max(...ch.d)}{ch.unit === "%" ? "%" : ""}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: space[1], fontSize: t.tiny.size, color: colors.text.muted }}>
              {dayLabels.map((d, i) => <span key={i}>{d}</span>)}
            </div>
          </div>
        ))}
      </div>

      {/* Export */}
      {content.length > 0 && (
        <div style={{ display: "flex", gap: space[2], marginBottom: space[5] }}>
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

      {/* Content with filters */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space[3], flexWrap: "wrap", gap: space[2] }}>
        <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>
          Content {hasActiveFilter && <span style={{ fontSize: t.bodySm.size, color: colors.text.disabled }}>({filteredContent.length})</span>}
        </div>
        <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
          {(["all", "quality", "slop"] as const).map(v => (
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
            {hasActiveFilter ? "Try adjusting your filters" : "Add sources or analyze content to get started"}
          </div>
        </div>
      ) : (
        <>
          {filteredContent.slice(0, showAllContent ? 50 : 5).map((it, i) => (
            <div key={it.id} style={{ animation: `slideUp .2s ease ${i * 0.03}s both` }}>
              <ContentCard
                item={it}
                expanded={expanded === it.id}
                onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
                onValidate={onValidate}
                onFlag={onFlag}
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
