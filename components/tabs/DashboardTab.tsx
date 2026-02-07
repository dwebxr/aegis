"use client";
import React, { useState, useMemo } from "react";
import { ShieldIcon, FireIcon, ZapIcon, RSSIcon } from "@/components/icons";
import { StatCard } from "@/components/ui/StatCard";
import { MiniChart } from "@/components/ui/MiniChart";
import { ContentCard } from "@/components/ui/ContentCard";
import { colors, space, type as t, radii, transitions } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";

interface DashboardTabProps {
  content: ContentItem[];
  mobile?: boolean;
  onValidate?: (id: string) => void;
  onFlag?: (id: string) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({ content, mobile, onValidate, onFlag }) => {
  const [showBurned, setShowBurned] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { todayContent, todayQual, todaySlop, qual, slop, uniqueSources, dailyQuality, dailySlop, dayLabels } = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const todayStart = now - dayMs;
    const dayNames = ["S", "M", "T", "W", "T", "F", "S"];

    const todayContent = content.filter(c => c.createdAt >= todayStart);
    const todayQual = todayContent.filter(c => c.verdict === "quality");
    const todaySlop = todayContent.filter(c => c.verdict === "slop");
    const qual = content.filter(c => c.verdict === "quality");
    const slop = content.filter(c => c.verdict === "slop");
    const uniqueSources = new Set(content.map(c => c.source));

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
    return { todayContent, todayQual, todaySlop, qual, slop, uniqueSources, dailyQuality, dailySlop, dayLabels };
  }, [content]);

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
            fontSize: mobile ? t.body.mobileSz : t.body.size,
            lineHeight: t.body.lineHeight,
            color: colors.text.muted,
            marginTop: space[2],
          }}>
            Content quality filter that learns your taste, curates a zero-noise briefing, publishes signals to Nostr, and exchanges content with other agents over an encrypted D2A protocol.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: mobile ? space[3] : space[4] }}>
          <StatCard icon={<ShieldIcon s={16} />} label="Quality" value={todayQual.length} sub={`of ${todayContent.length} evaluated today`} color={colors.cyan[400]} mobile={mobile} />
          <StatCard icon={<FireIcon s={16} />} label="Burned" value={todaySlop.length} sub="slop items filtered today" color={colors.orange[400]} mobile={mobile} />
          <StatCard icon={<ZapIcon s={16} />} label="Evaluated" value={todayContent.length} sub="total items today" color={colors.purple[400]} mobile={mobile} />
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
          { title: "Filter Accuracy", d: dailyQuality, c: colors.green[400], unit: "%" },
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
              <span style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>
                {ch.title}
              </span>
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

      {/* Latest Quality */}
      <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[3] }}>
        Latest Quality
      </div>
      {qual.slice(0, 3).map(it => (
        <ContentCard
          key={it.id}
          item={it}
          expanded={expanded === it.id}
          onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
          onValidate={onValidate || (() => {})}
          onFlag={onFlag || (() => {})}
          mobile={mobile}
        />
      ))}

      {/* Recently Burned */}
      {slop.length > 0 && (
        <div style={{ marginTop: space[5] }}>
          <button
            onClick={() => setShowBurned(!showBurned)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: space[2],
              padding: `${space[3]}px ${space[4]}px`,
              background: colors.bg.surface,
              border: `1px solid ${colors.border.default}`,
              borderRadius: radii.md,
              color: colors.text.muted,
              fontSize: t.bodySm.size,
              fontWeight: 600,
              cursor: "pointer",
              transition: transitions.normal,
              fontFamily: "inherit",
            }}
          >
            <span style={{
              transform: showBurned ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform .2s",
              display: "inline-block",
            }}>
              &#x25BC;
            </span>
            Recently Burned ({slop.length} items)
          </button>

          {showBurned && (
            <div style={{ marginTop: space[3] }}>
              {slop.slice(0, 5).map((it, i) => (
                <div key={it.id} style={{ animation: `slideUp .2s ease ${i * 0.03}s both` }}>
                  <ContentCard
                    item={it}
                    expanded={expanded === it.id}
                    onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
                    onValidate={onValidate || (() => {})}
                    onFlag={onFlag || (() => {})}
                    mobile={mobile}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
