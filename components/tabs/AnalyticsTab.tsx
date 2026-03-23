"use client";
import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/design";
import { colors } from "@/styles/theme";
import { isD2AContent } from "@/lib/d2a/activity";
import { ShieldIcon, FireIcon, ZapIcon } from "@/components/icons";
import { StatCard } from "@/components/ui/StatCard";
import { MetricPill } from "@/components/ui/MetricPill";
import { GlossaryModal, GlossaryButton } from "@/components/ui/GlossaryModal";
import { BarChart } from "@/components/ui/BarChart";
import { MiniChart } from "@/components/ui/MiniChart";
import { D2ANetworkMini } from "@/components/ui/D2ANetworkMini";
import { scoreColor } from "@/lib/utils/scores";
import { formatICP } from "@/lib/ic/icpLedger";
import type { ContentItem } from "@/lib/types/content";
import type { UserReputation } from "@/lib/ic/declarations";
import type { AgentState } from "@/lib/agent/types";
import { useDemo } from "@/contexts/DemoContext";
import { CostInsights } from "@/components/filtering/CostInsights";
import type { FilterPipelineStats } from "@/lib/filtering/types";
import { ENGINE_LABELS } from "@/lib/scoring/types";
import type { ScoringEngine } from "@/lib/scoring/types";
import {
  computeDashboardActivity,
  computeTopicDistribution,
  computeTopicTrends,
} from "@/lib/dashboard/utils";

interface AnalyticsTabProps {
  content: ContentItem[];
  reputation?: UserReputation | null;
  engagementIndex?: number | null;
  agentState?: AgentState | null;
  mobile?: boolean;
  pipelineStats?: FilterPipelineStats | null;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ content, reputation, engagementIndex, agentState, mobile, pipelineStats }) => {
  const { isDemoMode } = useDemo();
  const [activityRange, setActivityRange] = useState<"today" | "7d" | "30d">("7d");
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const activity = useMemo(() => computeDashboardActivity(content, activityRange), [content, activityRange]);
  const topicDist = useMemo(() => computeTopicDistribution(content), [content]);
  const topicTrends = useMemo(() => computeTopicTrends(content), [content]);
  const trendsMap = useMemo(() => new Map(topicTrends.map(t => [t.topic, t])), [topicTrends]);

  const { qualCount, validatedCount, flaggedCount, falsePositives, sourceDistribution, engineDistribution, scoreBuckets } = useMemo(() => {
    let qual = 0, validated = 0, flagged = 0, fp = 0;
    const srcDist: Record<string, number> = {};
    const engDist: Record<string, number> = {};
    const buckets = Array(10).fill(0) as number[];
    for (const c of content) {
      if (c.verdict === "quality") qual++;
      if (c.validated) validated++;
      if (c.flagged) flagged++;
      if (c.verdict === "quality" && c.flagged) fp++;
      srcDist[c.source] = (srcDist[c.source] || 0) + 1;
      const eng = c.scoringEngine || (c.scoredByAI ? "claude-server" : "heuristic");
      engDist[eng] = (engDist[eng] || 0) + 1;
      buckets[Math.max(0, Math.min(9, Math.floor(c.scores.composite)))]++;
    }
    return { qualCount: qual, validatedCount: validated, flaggedCount: flagged, falsePositives: fp, sourceDistribution: srcDist, engineDistribution: engDist, scoreBuckets: buckets };
  }, [content]);

  const accuracy = content.length > 0 ? ((qualCount / content.length) * 100).toFixed(1) : "--";
  const userReviewed = validatedCount + flaggedCount;
  const falsePositiveRate = qualCount > 0 ? ((falsePositives / qualCount) * 100).toFixed(1) : "--";

  return (
    <div className="animate-fade-in">
      {isDemoMode && (
        <div data-testid="aegis-analytics-demo-banner" className="bg-blue-600/[0.04] border border-blue-600/15 rounded-md px-4 py-2 mb-4 text-body-sm text-blue-400 font-semibold">
          Analytics based on demo data. Login for persistent tracking.
        </div>
      )}
      <div className={mobile ? "mb-8" : "mb-12"}>
        <div className="flex items-center justify-between">
          <h1 data-testid="aegis-analytics-heading" className={cn(typography.display, "text-foreground m-0", mobile && "text-[24px]")}>
            Analytics
          </h1>
          <GlossaryButton onClick={() => setGlossaryOpen(true)} />
        </div>
        <p data-testid="aegis-analytics-subtitle" className={cn("text-muted-foreground mt-2", mobile ? "text-[13px]" : "text-body")}>
          Performance &amp; content metrics
        </p>
      </div>
      <GlossaryModal open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />

      <div className={cn("grid gap-4 mb-16", mobile ? "grid-cols-1 gap-3 mb-12" : "grid-cols-3")}>
        <StatCard icon={<ShieldIcon s={16} />} label="Accuracy" value={`${accuracy}%`} sub={`${qualCount} quality / ${content.length} total`} color={colors.green[400]} mobile={mobile} />
        <StatCard icon={<FireIcon s={16} />} label="False Positive" value={falsePositiveRate === "--" ? "--" : `${falsePositiveRate}%`} sub={userReviewed > 0 ? `${userReviewed} user-reviewed` : "no reviews yet"} color={colors.orange[400]} mobile={mobile} />
        <StatCard icon={<ZapIcon s={16} />} label="User Reviews" value={userReviewed} sub={`${validatedCount} validated, ${flaggedCount} flagged`} color={colors.purple[400]} mobile={mobile} />
      </div>

      {/* Activity Trends + Topic Breakdown */}
      <div data-testid="aegis-analytics-activity-trends" className={cn(
        mobile
          ? "flex flex-col gap-4 mb-12"
          : "grid grid-cols-2 gap-4 items-start mb-16"
      )}>
        {/* Activity Trends */}
        <div className="bg-transparent border border-subtle rounded-lg px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-body-sm font-semibold text-tertiary flex items-center gap-2">
              <span>&#x26A1;</span> Activity Trends
            </div>
            <div className="flex gap-1 bg-navy-lighter rounded-md p-1 border border-border">
              {(["today", "7d", "30d"] as const).map(range => {
                const active = activityRange === range;
                return (
                  <button
                    key={range}
                    onClick={() => setActivityRange(range)}
                    className={cn(
                      "px-2 py-1 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
                      active
                        ? "bg-card border border-emphasis text-foreground"
                        : "bg-transparent border border-transparent text-muted-foreground"
                    )}
                  >
                    {range === "today" ? "Today" : range}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap mb-3">
            <MetricPill icon={<ShieldIcon s={12} />} value={activity.qualityCount} tooltip="Quality items in this period" color={colors.cyan[400]} />
            <MetricPill icon={<FireIcon s={12} />} value={activity.slopCount} tooltip="Items burned (filtered as slop)" color={colors.orange[400]} />
            <MetricPill icon={<ZapIcon s={12} />} value={activity.totalEvaluated} tooltip="Total items evaluated" color={colors.purple[400]} />
          </div>
          {activity.chartQuality.length > 0 && (
            <div className="flex gap-4 mb-3 items-center">
              <div className="flex items-center gap-1">
                <div className="w-20">
                  <MiniChart data={activity.chartQuality} color={colors.cyan[400]} h={24} />
                </div>
                <span className="text-tiny text-cyan-400 font-mono">
                  {activity.chartQuality[activity.chartQuality.length - 1]}% quality
                </span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-20">
                  <MiniChart data={activity.chartSlop} color={colors.orange[500]} h={24} />
                </div>
                <span className="text-tiny text-orange-500 font-mono">
                  {activity.chartSlop[activity.chartSlop.length - 1]} slop
                </span>
              </div>
            </div>
          )}
          {activity.recentActions.length > 0 && (
            <div className="flex flex-col gap-2">
              {activity.recentActions.map(item => (
                <div key={item.id} className="flex items-center gap-2 text-caption text-disabled">
                  <span className={item.validated ? "text-emerald-400" : "text-red-400"}>
                    {item.validated ? "\u2713" : "\u2717"}
                  </span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {item.text.slice(0, 60)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Topic Breakdown */}
        <div data-testid="aegis-analytics-topic-breakdown" className="bg-transparent border border-subtle rounded-lg px-4 py-3">
          <div className="text-body-sm font-semibold text-tertiary mb-3 flex items-center gap-2">
            <span>&#x1F4CA;</span> Topic Breakdown
          </div>
          {topicDist.length === 0 ? (
            <div className="text-body-sm text-disabled text-center p-4">
              Add sources to see topic distribution.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {topicDist.map(entry => {
                const maxCount = topicDist[0]?.count ?? 0;
                const barWidth = maxCount > 0 ? Math.max((entry.count / maxCount) * 100, 8) : 0;
                const barColor = entry.qualityRate >= 0.6 ? colors.cyan[400] : entry.qualityRate >= 0.3 ? colors.sky[400] : colors.orange[400];
                return (
                  <div key={entry.topic} className="flex items-center gap-2">
                    <span className="w-[72px] text-caption text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap shrink-0 text-right">
                      {entry.topic}
                    </span>
                    <div className="flex-1 h-3.5 bg-navy-lighter rounded-sm overflow-hidden">
                      <div
                        className="h-full rounded-sm"
                        style={{ width: `${barWidth}%`, background: `${barColor}40`, transition: "width 0.3s ease" }}
                      />
                    </div>
                    <span className="w-7 text-caption text-disabled font-mono text-right shrink-0">
                      {entry.count}
                    </span>
                    {(() => {
                      const trend = trendsMap.get(entry.topic);
                      if (!trend) return null;
                      const arrow = trend.direction === "up" ? "\u2191" : trend.direction === "down" ? "\u2193" : "\u2192";
                      const arrowColor = trend.direction === "up" ? colors.green[400] : trend.direction === "down" ? colors.red[400] : colors.text.disabled;
                      return (
                        <>
                          <span className="w-[50px] text-caption font-semibold text-right shrink-0" style={{ color: arrowColor }}>
                            {arrow} {Math.abs(trend.changePercent)}%
                          </span>
                          <div className="flex items-end gap-px h-3.5 w-5 shrink-0">
                            {trend.weeklyHistory.map((count, i) => {
                              const max = Math.max(...trend.weeklyHistory, 1);
                              return (
                                <div key={`w${i}`} style={{
                                  width: 3, borderRadius: 1,
                                  height: Math.max((count / max) * 14, 2),
                                  background: i === trend.weeklyHistory.length - 1 ? barColor : `${colors.text.disabled}40`,
                                }} />
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                );
              })}
              <div className="text-tiny text-disabled mt-1 flex gap-3">
                <span><span className="inline-block size-2 rounded-[2px] mr-1" style={{ background: `${colors.cyan[400]}40` }} />high quality</span>
                <span><span className="inline-block size-2 rounded-[2px] mr-1" style={{ background: `${colors.orange[400]}40` }} />mixed</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={cn("grid gap-4 mb-16", mobile ? "grid-cols-1 gap-3 mb-12" : "grid-cols-2")}>
        <div className={cn("bg-card border border-border rounded-lg", mobile ? "p-4" : "p-5")}>
          <div className="text-h3 font-semibold text-tertiary mb-4">Score Distribution</div>
          <BarChart data={scoreBuckets} labels={["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]} color={colors.sky[400]} />
        </div>
        <div className={cn("bg-card border border-border rounded-lg", mobile ? "p-4" : "p-5")}>
          <div className="text-h3 font-semibold text-tertiary mb-4">Content Sources</div>
          <BarChart data={Object.values(sourceDistribution)} labels={Object.keys(sourceDistribution)} color={colors.purple[400]} />
        </div>
      </div>

      {Object.keys(engineDistribution).length > 0 && (
        <div className={cn("grid grid-cols-1 gap-4 mb-16", mobile && "gap-3 mb-12")}>
          <div className={cn("bg-card border border-border rounded-lg", mobile ? "p-4" : "p-5")}>
            <div className="text-h3 font-semibold text-tertiary mb-4">Scoring Engines</div>
            <BarChart data={Object.values(engineDistribution)} labels={Object.keys(engineDistribution).map(k => ENGINE_LABELS[k as ScoringEngine] || k)} color={colors.cyan[400]} />
          </div>
        </div>
      )}

      {pipelineStats && (
        <div className={mobile ? "mb-3" : "mb-4"}>
          <CostInsights stats={pipelineStats} mobile={mobile} expanded />
        </div>
      )}

      {reputation && (
        <div className={cn("bg-card border border-border rounded-lg", mobile ? "p-4 mt-3" : "p-5 mt-4")}>
          <div className="text-h3 font-semibold text-amber-400 mb-4">Trust Score</div>

          <div className={cn("flex items-center flex-wrap mb-4", mobile ? "gap-4" : "gap-6")}>
            <div className="text-center">
              <div className={cn("font-[800] font-mono", mobile ? "text-[36px]" : "text-[48px]")} style={{ color: scoreColor(reputation.trustScore) }}>
                {reputation.trustScore.toFixed(1)}
              </div>
              <div className={typography.kpiLabel}>Trust Score</div>
            </div>

            <div className="flex-1 min-w-[120px]">
              <div className="h-2.5 bg-navy-lighter rounded-[5px] overflow-hidden relative">
                <div
                  className="h-full rounded-[5px]"
                  style={{
                    width: `${(reputation.trustScore / 10) * 100}%`,
                    background: "linear-gradient(90deg, #ef4444, #f59e0b, #34d399)",
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-tiny text-muted-foreground">0</span>
                <span className="text-tiny text-muted-foreground">10</span>
              </div>
            </div>
          </div>

          <div className={cn("grid gap-3", mobile ? "grid-cols-2 gap-2" : "grid-cols-4")}>
            {[
              ["Total Deposited", formatICP(reputation.totalStaked) + " ICP", colors.amber[400]],
              ["Returned", formatICP(reputation.totalReturned) + " ICP", colors.green[400]],
              ["Forfeited", formatICP(reputation.totalSlashed) + " ICP", colors.orange[400]],
              ["Return Rate", returnRate(reputation), colors.sky[400]],
            ].map(([l, v, c]) => (
              <div key={l} className="text-center px-2 py-3 bg-navy-lighter rounded-sm">
                <div className={cn(typography.kpiLabel, "mb-1")}>{l}</div>
                <div className={cn("font-bold font-mono", mobile ? "text-body-sm" : "text-body")} style={{ color: c as string }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-3">
            <div className="flex-1 text-center p-2 bg-emerald-500/[0.06] rounded-sm">
              <div className={cn("font-bold font-mono text-emerald-400", mobile ? "text-[18px]" : "text-h2")}>{reputation.qualitySignals.toString()}</div>
              <div className={typography.kpiLabel}>Quality Signals</div>
            </div>
            <div className="flex-1 text-center p-2 bg-red-400/[0.06] rounded-sm">
              <div className={cn("font-bold font-mono text-orange-400", mobile ? "text-[18px]" : "text-h2")}>{reputation.slopSignals.toString()}</div>
              <div className={typography.kpiLabel}>Flagged Signals</div>
            </div>
          </div>
        </div>
      )}

      {(engagementIndex != null || agentState) && (
        <div className={cn("grid gap-4", mobile ? "grid-cols-1 gap-3 mt-3" : "grid-cols-2 mt-4")}>
          {engagementIndex != null && (
            <div className={cn("bg-card border border-border rounded-lg", mobile ? "p-4" : "p-5")}>
              <div className="text-h3 font-semibold text-sky-400 mb-4">Engagement Index</div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className={cn("font-[800] font-mono", mobile ? "text-[36px]" : "text-[48px]")} style={{ color: scoreColor(engagementIndex) }}>
                    {engagementIndex.toFixed(2)}
                  </div>
                  <div className={typography.kpiLabel}>E_index</div>
                </div>
                <div className="flex-1">
                  <div className="h-2 bg-navy-lighter rounded-[4px] overflow-hidden">
                    <div
                      className="h-full rounded-[4px]"
                      style={{
                        width: `${Math.min(100, (engagementIndex / 10) * 100)}%`,
                        background: `linear-gradient(90deg, ${colors.sky[400]}, ${colors.purple[400]})`,
                      }}
                    />
                  </div>
                  <div className="text-caption text-muted-foreground mt-1.5">
                    Measures how effectively your signals engage the community.
                    Higher = more validated, higher-quality signals.
                  </div>
                </div>
              </div>
            </div>
          )}

          {agentState && (
            <div className={cn("bg-card border border-border rounded-lg", mobile ? "p-4" : "p-5")}>
              <div className="flex items-center gap-2 mb-4">
                <div className="text-h3 font-semibold text-purple-400">D2A Agent</div>
                <div className={cn(
                  "text-tiny font-bold px-2 py-0.5 rounded-lg uppercase",
                  agentState.isActive
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-slate-500/15 text-muted-foreground"
                )}>
                  {agentState.isActive ? "Active" : "Idle"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Peers", String(agentState.peers.length), colors.purple[400]],
                  ["Handshakes", String(agentState.activeHandshakes.length), colors.sky[400]],
                  ["Sent", String(agentState.sentItems), colors.green[400]],
                  ["Received", String(agentState.receivedItems), colors.amber[400]],
                  ["Validated", String(validatedCount), colors.green[400]],
                  ["Flagged", String(flaggedCount), colors.red[400]],
                  ["D2A Received", String(content.filter(isD2AContent).length), colors.purple[400]],
                  ["Fee Matches", String(agentState.d2aMatchCount), colors.amber[400]],
                ].map(([l, v, c]) => (
                  <div key={l} className="text-center p-2 bg-navy-lighter rounded-sm">
                    <div className={cn(typography.kpiLabel, "mb-1")}>{l}</div>
                    <div className="text-h2 font-bold font-mono" style={{ color: c }}>{v}</div>
                  </div>
                ))}
              </div>
              <D2ANetworkMini mobile={mobile} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function returnRate(rep: UserReputation): string {
  const total = Number(rep.qualitySignals) + Number(rep.slopSignals);
  if (total === 0) return "--";
  return ((Number(rep.qualitySignals) / total) * 100).toFixed(1) + "%";
}
