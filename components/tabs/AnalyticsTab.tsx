"use client";
import React from "react";
import { fonts, colors, space, type as t, radii, kpiLabelStyle } from "@/styles/theme";
import { ShieldIcon, FireIcon, ZapIcon } from "@/components/icons";
import { StatCard } from "@/components/ui/StatCard";
import { BarChart } from "@/components/ui/BarChart";
import { formatICP } from "@/lib/ic/icpLedger";
import type { ContentItem } from "@/lib/types/content";
import type { UserReputation } from "@/lib/ic/declarations";
import type { AgentState } from "@/lib/agent/types";

interface AnalyticsTabProps {
  content: ContentItem[];
  reputation?: UserReputation | null;
  engagementIndex?: number | null;
  agentState?: AgentState | null;
  mobile?: boolean;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ content, reputation, engagementIndex, agentState, mobile }) => {
  const qual = content.filter(c => c.verdict === "quality");
  const slop = content.filter(c => c.verdict === "slop");
  const accuracy = content.length > 0 ? ((qual.length / content.length) * 100).toFixed(1) : "0.0";

  const validated = content.filter(c => c.validated);
  const flagged = content.filter(c => c.flagged);
  const userReviewed = validated.length + flagged.length;
  const falsePositives = content.filter(c => c.verdict === "quality" && c.flagged).length;
  const totalPredictedQuality = qual.length;
  const falsePositiveRate = totalPredictedQuality > 0 ? ((falsePositives / totalPredictedQuality) * 100).toFixed(1) : "--";

  const sourceDistribution: Record<string, number> = {};
  for (const c of content) {
    sourceDistribution[c.source] = (sourceDistribution[c.source] || 0) + 1;
  }

  const scoreBuckets = Array(10).fill(0);
  for (const c of content) {
    const idx = Math.max(0, Math.min(9, Math.floor(c.scores.composite)));
    scoreBuckets[idx]++;
  }

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: mobile ? space[8] : space[12] }}>
        <h1 style={{
          fontSize: mobile ? t.display.mobileSz : t.display.size,
          fontWeight: t.display.weight,
          lineHeight: t.display.lineHeight,
          letterSpacing: t.display.letterSpacing,
          color: colors.text.primary,
          margin: 0,
        }}>
          Analytics
        </h1>
        <p style={{ fontSize: mobile ? t.body.mobileSz : t.body.size, color: colors.text.muted, marginTop: space[2] }}>
          Performance & content metrics
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(3,1fr)", gap: mobile ? space[3] : space[4], marginBottom: mobile ? space[12] : space[16] }}>
        <StatCard icon={<ShieldIcon s={16} />} label="Accuracy" value={`${accuracy}%`} sub={`${qual.length} quality / ${content.length} total`} color={colors.green[400]} mobile={mobile} />
        <StatCard icon={<FireIcon s={16} />} label="False Positive" value={falsePositiveRate === "--" ? "--" : `${falsePositiveRate}%`} sub={userReviewed > 0 ? `${userReviewed} user-reviewed` : "no reviews yet"} color={colors.orange[400]} mobile={mobile} />
        <StatCard icon={<ZapIcon s={16} />} label="User Reviews" value={userReviewed} sub={`${validated.length} validated, ${flagged.length} flagged`} color={colors.purple[400]} mobile={mobile} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? space[3] : space[4], marginBottom: mobile ? space[12] : space[16] }}>
        <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5] }}>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[4] }}>Score Distribution</div>
          <BarChart data={scoreBuckets} labels={["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]} color={colors.sky[400]} />
        </div>
        <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5] }}>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[4] }}>Content Sources</div>
          <BarChart data={Object.values(sourceDistribution)} labels={Object.keys(sourceDistribution)} color={colors.purple[400]} />
        </div>
      </div>

      <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5] }}>
        <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[4] }}>Evaluation Summary</div>
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? space[2] : space[3] }}>
          {[
            ["Total Evaluated", String(content.length), colors.sky[400]],
            ["Quality Found", String(qual.length), colors.green[400]],
            ["Slop Caught", String(slop.length), colors.orange[400]],
            ["Accuracy", `${accuracy}%`, colors.amber[400]],
          ].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "center", padding: `${space[3]}px ${space[2]}px`, background: colors.bg.raised, borderRadius: radii.sm }}>
              <div style={{ ...kpiLabelStyle, marginBottom: space[1] }}>{l}</div>
              <div style={{ fontSize: mobile ? t.h1.mobileSz : t.h1.size, fontWeight: t.kpiValue.weight, color: c, fontFamily: fonts.mono }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {reputation && (
        <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5], marginTop: mobile ? space[3] : space[4] }}>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.amber[400], marginBottom: space[4] }}>Trust Score</div>

          <div style={{ display: "flex", alignItems: "center", gap: mobile ? 16 : 24, marginBottom: space[4], flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: mobile ? 36 : 48, fontWeight: 800, color: trustColor(reputation.trustScore), fontFamily: fonts.mono }}>
                {reputation.trustScore.toFixed(1)}
              </div>
              <div style={{ ...kpiLabelStyle }}>Trust Score</div>
            </div>

            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{
                height: 10,
                background: colors.bg.raised,
                borderRadius: 5,
                overflow: "hidden",
                position: "relative",
              }}>
                <div style={{
                  height: "100%",
                  width: `${(reputation.trustScore / 10) * 100}%`,
                  background: `linear-gradient(90deg, #ef4444, #f59e0b, #34d399)`,
                  borderRadius: 5,
                  transition: "width 0.5s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 9, color: colors.text.muted }}>0</span>
                <span style={{ fontSize: 9, color: colors.text.muted }}>10</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? space[2] : space[3] }}>
            {[
              ["Total Deposited", formatICP(reputation.totalStaked) + " ICP", colors.amber[400]],
              ["Returned", formatICP(reputation.totalReturned) + " ICP", colors.green[400]],
              ["Forfeited", formatICP(reputation.totalSlashed) + " ICP", colors.orange[400]],
              ["Return Rate", returnRate(reputation), colors.sky[400]],
            ].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center", padding: `${space[3]}px ${space[2]}px`, background: colors.bg.raised, borderRadius: radii.sm }}>
                <div style={{ ...kpiLabelStyle, marginBottom: space[1] }}>{l}</div>
                <div style={{ fontSize: mobile ? t.bodySm.size : t.body.size, fontWeight: t.kpiValue.weight, color: c, fontFamily: fonts.mono }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: space[3], marginTop: space[3] }}>
            <div style={{ flex: 1, textAlign: "center", padding: `${space[2]}px`, background: "rgba(52,211,153,0.06)", borderRadius: radii.sm }}>
              <div style={{ fontSize: mobile ? t.h2.mobileSz : t.h2.size, fontWeight: 700, color: colors.green[400], fontFamily: fonts.mono }}>{reputation.qualitySignals.toString()}</div>
              <div style={{ ...kpiLabelStyle }}>Quality Signals</div>
            </div>
            <div style={{ flex: 1, textAlign: "center", padding: `${space[2]}px`, background: "rgba(248,113,113,0.06)", borderRadius: radii.sm }}>
              <div style={{ fontSize: mobile ? t.h2.mobileSz : t.h2.size, fontWeight: 700, color: colors.orange[400], fontFamily: fonts.mono }}>{reputation.slopSignals.toString()}</div>
              <div style={{ ...kpiLabelStyle }}>Flagged Signals</div>
            </div>
          </div>
        </div>
      )}

      {(engagementIndex != null || agentState) && (
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? space[3] : space[4], marginTop: mobile ? space[3] : space[4] }}>
          {engagementIndex != null && (
            <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5] }}>
              <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.sky[400], marginBottom: space[4] }}>Engagement Index</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: mobile ? 36 : 48, fontWeight: 800, color: trustColor(engagementIndex), fontFamily: fonts.mono }}>
                    {engagementIndex.toFixed(2)}
                  </div>
                  <div style={{ ...kpiLabelStyle }}>E_index</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    height: 8,
                    background: colors.bg.raised,
                    borderRadius: 4,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(100, (engagementIndex / 10) * 100)}%`,
                      background: `linear-gradient(90deg, ${colors.sky[400]}, ${colors.purple[400]})`,
                      borderRadius: 4,
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: colors.text.muted, marginTop: 6 }}>
                    Measures how effectively your signals engage the community.
                    Higher = more validated, higher-quality signals.
                  </div>
                </div>
              </div>
            </div>
          )}

          {agentState && (
            <div style={{ background: colors.bg.surface, border: `1px solid ${colors.border.default}`, borderRadius: radii.lg, padding: mobile ? space[4] : space[5] }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: space[4] }}>
                <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.purple[400] }}>D2A Agent</div>
                <div style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 8,
                  background: agentState.isActive ? "rgba(52,211,153,0.15)" : "rgba(100,116,139,0.15)",
                  color: agentState.isActive ? colors.green[400] : colors.text.muted,
                  textTransform: "uppercase",
                }}>
                  {agentState.isActive ? "Active" : "Idle"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space[2] }}>
                {[
                  ["Peers", String(agentState.peers.length), colors.purple[400]],
                  ["Handshakes", String(agentState.activeHandshakes.length), colors.sky[400]],
                  ["Sent", String(agentState.sentItems), colors.green[400]],
                  ["Received", String(agentState.receivedItems), colors.amber[400]],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ textAlign: "center", padding: `${space[2]}px`, background: colors.bg.raised, borderRadius: radii.sm }}>
                    <div style={{ ...kpiLabelStyle, marginBottom: space[1] }}>{l}</div>
                    <div style={{ fontSize: t.h2.size, fontWeight: 700, color: c, fontFamily: fonts.mono }}>{v}</div>
                  </div>
                ))}
              </div>
              {agentState.d2aMatchCount > 0 && (
                <div style={{ marginTop: space[3], textAlign: "center", padding: `${space[2]}px`, background: "rgba(245,158,11,0.06)", borderRadius: radii.sm }}>
                  <div style={{ fontSize: t.h2.size, fontWeight: 700, color: colors.amber[400], fontFamily: fonts.mono }}>{agentState.d2aMatchCount}</div>
                  <div style={{ ...kpiLabelStyle }}>Fee-Paid Matches</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function trustColor(score: number): string {
  if (score >= 7) return "#34d399";
  if (score >= 4) return "#f59e0b";
  return "#f87171";
}

function returnRate(rep: UserReputation): string {
  const total = Number(rep.qualitySignals) + Number(rep.slopSignals);
  if (total === 0) return "--";
  return ((Number(rep.qualitySignals) / total) * 100).toFixed(1) + "%";
}
