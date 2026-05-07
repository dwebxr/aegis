"use client";
import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useSources } from "@/contexts/SourceContext";
import {
  computeSourceQualityStats,
  computeUnattributedStats,
  type SourceQualityStats,
  type SourceRecommendation,
  type TimeWindow,
  TIME_WINDOWS,
} from "@/lib/dashboard/sourceQuality";
import { loadSourceStates, type SourceRuntimeState } from "@/lib/ingestion/sourceState";
import type { ContentItem } from "@/lib/types/content";

interface SourceQualitySectionProps {
  content: ContentItem[];
  mobile?: boolean;
}

const RECOMMENDATION_LABEL: Record<SourceRecommendation, string> = {
  keep: "Keep",
  watch: "Watch",
  mute: "Mute",
  remove: "Remove",
  insufficient_data: "Learning",
};

// Class-based styling avoids the inline-style alpha-suffix bug that broke
// the insufficient_data branch (var(--...)40 is invalid CSS; hex+40 is RGBA).
const RECOMMENDATION_BADGE_CLASS: Record<SourceRecommendation, string> = {
  keep: "text-green-400 border-green-400/30 bg-green-400/[0.08]",
  watch: "text-amber-400 border-amber-400/30 bg-amber-400/[0.08]",
  mute: "text-orange-400 border-orange-400/30 bg-orange-400/[0.08]",
  remove: "text-red-400 border-red-400/30 bg-red-400/[0.08]",
  insufficient_data: "text-disabled border-border bg-navy-lighter",
};

const WINDOWS: ReadonlyArray<TimeWindow> = ["7d", "30d", "all"] as const;

const TOP_N = 5;
const BOTTOM_N = 5;

export const SourceQualitySection: React.FC<SourceQualitySectionProps> = ({ content, mobile }) => {
  const { sources, removeSource, toggleSource } = useSources();
  const [window, setWindow] = useState<TimeWindow>("30d");
  const [runtimeStates, setRuntimeStates] = useState<Record<string, SourceRuntimeState>>(loadSourceStates);

  useEffect(() => {
    const refresh = () => setRuntimeStates(loadSourceStates());
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, 60_000);
    const onVisible = () => { if (typeof document !== "undefined" && !document.hidden) refresh(); };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  const { stats, unattributed } = useMemo(() => {
    const since = window === "all" ? 0 : Date.now() - TIME_WINDOWS[window];
    const stateMap = new Map(Object.entries(runtimeStates));
    return {
      stats: computeSourceQualityStats(content, sources, stateMap, since),
      unattributed: computeUnattributedStats(content, sources, since),
    };
  }, [content, sources, runtimeStates, window]);

  const ranked = useMemo(() => {
    const ready = stats.filter(s => s.recommendation !== "insufficient_data");
    return [...ready].sort((a, b) => b.qualityYield - a.qualityYield);
  }, [stats]);

  const top = ranked.slice(0, TOP_N);
  const bottom = ranked.length > TOP_N
    ? ranked.slice(Math.max(TOP_N, ranked.length - BOTTOM_N)).reverse()
    : [];
  const learning = stats.filter(s => s.recommendation === "insufficient_data");

  if (sources.length === 0) return null;

  const totalUnattributed = unattributed.d2a.scored + unattributed.manual.scored + unattributed.sharedUrl.scored;

  return (
    <div data-testid="aegis-source-quality" className={cn("bg-card border border-border rounded-lg mb-16", mobile ? "p-4 mb-12" : "p-5")}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="text-h3 font-semibold text-tertiary">Source Quality</div>
        <div className="flex gap-1 bg-navy-lighter rounded-md p-1 border border-border">
          {WINDOWS.map(w => {
            const active = window === w;
            return (
              <button
                key={w}
                onClick={() => setWindow(w)}
                data-testid={`aegis-source-quality-window-${w}`}
                className={cn(
                  "px-2 py-1 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
                  active
                    ? "bg-card border border-emphasis text-foreground"
                    : "bg-transparent border border-transparent text-muted-foreground"
                )}
              >
                {w === "all" ? "All" : w}
              </button>
            );
          })}
        </div>
      </div>

      {ranked.length === 0 && learning.length === stats.length && (
        <div className="text-body-sm text-muted-foreground py-2">
          Not enough data yet — sources need at least 10 scored items in this window before recommendations appear.
        </div>
      )}

      {top.length > 0 && (
        <div className="mb-5">
          <div className="text-tiny font-bold uppercase tracking-[0.5px] text-disabled mb-2">Top performers</div>
          <SourceList rows={top} mobile={mobile} onMute={toggleSource} onRemove={removeSource} />
        </div>
      )}

      {bottom.length > 0 && (
        <div className="mb-5">
          <div className="text-tiny font-bold uppercase tracking-[0.5px] text-disabled mb-2">Bottom performers</div>
          <SourceList rows={bottom} mobile={mobile} onMute={toggleSource} onRemove={removeSource} />
        </div>
      )}

      {learning.length > 0 && (
        <div className="mb-5">
          <div className="text-tiny font-bold uppercase tracking-[0.5px] text-disabled mb-2">
            Learning ({learning.length} {learning.length === 1 ? "source" : "sources"} below {/* eslint-disable-next-line @typescript-eslint/no-magic-numbers */}10 items)
          </div>
          <SourceList rows={learning} mobile={mobile} onMute={toggleSource} onRemove={removeSource} compact />
        </div>
      )}

      {totalUnattributed > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-tiny font-bold uppercase tracking-[0.5px] text-disabled mb-2">Unattributed</div>
          <div className={cn("grid gap-2", mobile ? "grid-cols-1" : "grid-cols-3")}>
            <UnattributedCard label="D2A" stats={unattributed.d2a} />
            <UnattributedCard label="Manual" stats={unattributed.manual} />
            <UnattributedCard label="Shared URL" stats={unattributed.sharedUrl} />
          </div>
        </div>
      )}
    </div>
  );
};

interface SourceListProps {
  rows: SourceQualityStats[];
  mobile?: boolean;
  onMute: (id: string) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}

const SourceList: React.FC<SourceListProps> = ({ rows, mobile, onMute, onRemove, compact }) => (
  <div className="flex flex-col gap-1.5">
    {rows.map(s => (
      <div
        key={s.id}
        data-testid={`aegis-source-quality-row-${s.id}`}
        className={cn(
          "flex items-center gap-3 rounded-sm",
          mobile ? "px-2.5 py-2" : "px-3 py-2",
          "bg-navy-lighter",
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("text-body-sm font-semibold text-secondary-foreground overflow-hidden text-ellipsis whitespace-nowrap", mobile && "text-caption")}>
              {s.label}
            </span>
            <RecommendationBadge rec={s.recommendation} />
          </div>
          {!compact && (
            <div className="text-tiny text-muted-foreground mt-0.5">
              {s.scored} scored · quality {(s.qualityYield * 100).toFixed(0)}% · slop {(s.slopRate * 100).toFixed(0)}%
              {s.reviewRate > 0 && <> · reviewed {(s.reviewRate * 100).toFixed(0)}%</>}
              {s.duplicatesSuppressed > 0 && <> · {s.duplicatesSuppressed} dup</>}
              {s.flagged > 0 && <> · {s.flagged} flagged</>}
              {s.validated > 0 && <> · {s.validated} validated</>}
            </div>
          )}
          {compact && (
            <div className="text-tiny text-muted-foreground mt-0.5">
              {s.scored} scored
            </div>
          )}
        </div>
        {(s.recommendation === "mute" || s.recommendation === "remove") && (
          <ActionChip
            kind={s.recommendation}
            enabled={s.enabled}
            onMute={() => onMute(s.id)}
            onRemove={() => onRemove(s.id)}
          />
        )}
      </div>
    ))}
  </div>
);

const RecommendationBadge: React.FC<{ rec: SourceRecommendation }> = ({ rec }) => (
  <span
    data-testid={`aegis-source-quality-badge-${rec}`}
    className={cn(
      "text-tiny font-bold uppercase tracking-[1px] px-1.5 py-px rounded-sm border whitespace-nowrap",
      RECOMMENDATION_BADGE_CLASS[rec],
    )}
  >
    {RECOMMENDATION_LABEL[rec]}
  </span>
);

interface ActionChipProps {
  kind: "mute" | "remove";
  enabled: boolean;
  onMute: () => void;
  onRemove: () => void;
}

const ActionChip: React.FC<ActionChipProps> = ({ kind, enabled, onMute, onRemove }) => {
  if (kind === "remove") {
    return (
      <button
        onClick={onRemove}
        data-testid="aegis-source-quality-remove"
        className="text-caption font-semibold px-2 py-1 rounded-sm bg-red-500/[0.08] text-red-400 border border-red-500/30 cursor-pointer font-[inherit] transition-fast"
        title="Remove this source"
      >
        Remove
      </button>
    );
  }
  return (
    <button
      onClick={onMute}
      data-testid="aegis-source-quality-mute"
      className="text-caption font-semibold px-2 py-1 rounded-sm bg-orange-500/[0.08] text-orange-400 border border-orange-500/30 cursor-pointer font-[inherit] transition-fast"
      title={enabled ? "Mute this source (stops fetching, keeps data)" : "Already muted"}
    >
      {enabled ? "Mute" : "Muted"}
    </button>
  );
};

interface UnattributedCardProps {
  label: string;
  stats: { scored: number; quality: number; slop: number };
}

const UnattributedCard: React.FC<UnattributedCardProps> = ({ label, stats }) => {
  const yieldPct = stats.scored > 0 ? (stats.quality / stats.scored) * 100 : 0;
  return (
    <div className="bg-navy-lighter rounded-sm px-3 py-2" data-testid={`aegis-source-quality-unattributed-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-tiny font-bold uppercase tracking-[0.5px] text-disabled">{label}</div>
      <div className="text-body-sm font-semibold text-secondary-foreground mt-0.5">
        {stats.scored} scored
      </div>
      {stats.scored > 0 && (
        <div className="text-tiny text-muted-foreground">
          quality {yieldPct.toFixed(0)}% · {stats.slop} slop
        </div>
      )}
    </div>
  );
};
