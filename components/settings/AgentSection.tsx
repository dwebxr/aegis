"use client";
import React, { useState } from "react";
import { colors, space, type as t, radii, fonts } from "@/styles/theme";
import { useAgent } from "@/contexts/AgentContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
import {
  MIN_OFFER_SCORE,
  RESONANCE_THRESHOLD,
  D2A_FEE_TRUSTED,
  D2A_FEE_UNKNOWN,
  D2A_APPROVE_AMOUNT,
} from "@/lib/agent/protocol";
import { cardStyle, sectionTitle } from "./styles";

interface AgentSectionProps {
  mobile?: boolean;
}

const subsectionLabel: React.CSSProperties = {
  fontSize: t.caption.size,
  color: colors.text.disabled,
  marginBottom: space[2],
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: 0.5,
};

export const AgentSection: React.FC<AgentSectionProps> = ({ mobile }) => {
  const { isEnabled: agentEnabled } = useAgent();
  const {
    profile, setTopicAffinity, removeTopicAffinity,
    setQualityThreshold, addFilterRule, removeFilterRule,
  } = usePreferences();

  const [newTopic, setNewTopic] = useState("");
  const [newBlockedAuthor, setNewBlockedAuthor] = useState("");
  const [newBurnPattern, setNewBurnPattern] = useState("");

  const interests = Object.entries(profile.topicAffinities)
    .filter(([, v]) => v >= 0.2)
    .sort(([, a], [, b]) => b - a);
  const authorRules = (profile.customFilterRules ?? []).filter(r => r.field === "author");
  const titleRules = (profile.customFilterRules ?? []).filter(r => r.field === "title");

  return (
    <>
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Agent Preferences</div>
        <div style={{ display: "flex", gap: space[4], marginBottom: space[4], flexWrap: "wrap" }}>
          {[
            { label: "Interests", value: String(interests.length), color: colors.cyan[400] },
            { label: "Threshold", value: profile.calibration.qualityThreshold.toFixed(1), color: colors.cyan[400] },
            { label: "Reviews", value: String(profile.totalValidated + profile.totalFlagged), color: colors.text.secondary },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: t.caption.size, fontWeight: 700, fontFamily: fonts.mono, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: space[4] }}>
          <div style={subsectionLabel}>Interests</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center" }}>
            {interests.map(([topic]) => (
              <span key={topic} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: t.caption.size, padding: `2px ${space[2]}px`,
                background: `${colors.cyan[400]}10`, border: `1px solid ${colors.cyan[400]}20`,
                borderRadius: radii.pill, color: colors.cyan[400],
              }}>
                {topic}
                <button
                  onClick={() => removeTopicAffinity(topic)}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: colors.cyan[400], padding: 0, fontSize: 14, lineHeight: 1,
                    display: "inline-flex", alignItems: "center",
                  }}
                >&times;</button>
              </span>
            ))}
            <input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value.slice(0, 30))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTopic.trim()) {
                  const val = newTopic.trim().toLowerCase();
                  if ((profile.topicAffinities[val] ?? 0) < 0.2) {
                    setTopicAffinity(val, 0.3);
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

        <div style={{ marginBottom: space[4] }}>
          <div style={subsectionLabel}>Blocked Authors</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center" }}>
            {authorRules.map(rule => (
              <span key={rule.id} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: t.caption.size, padding: `2px ${space[2]}px`,
                background: `${colors.red[400]}10`, border: `1px solid ${colors.red[400]}20`,
                borderRadius: radii.pill, color: colors.red[400],
              }}>
                {rule.pattern}
                <button
                  onClick={() => removeFilterRule(rule.id)}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: colors.red[400], padding: 0, fontSize: 14, lineHeight: 1,
                    display: "inline-flex", alignItems: "center",
                  }}
                >&times;</button>
              </span>
            ))}
            <input
              value={newBlockedAuthor}
              onChange={(e) => setNewBlockedAuthor(e.target.value.slice(0, 60))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newBlockedAuthor.trim()) {
                  addFilterRule({ field: "author", pattern: newBlockedAuthor.trim() });
                  setNewBlockedAuthor("");
                }
              }}
              placeholder="+ Block author"
              style={{
                width: 120, padding: `2px ${space[2]}px`,
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

        <div style={{ marginBottom: space[4] }}>
          <div style={subsectionLabel}>Burn Patterns</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center" }}>
            {titleRules.map(rule => (
              <span key={rule.id} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: t.caption.size, padding: `2px ${space[2]}px`,
                background: `${colors.orange[400]}10`, border: `1px solid ${colors.orange[400]}20`,
                borderRadius: radii.pill, color: colors.orange[400],
              }}>
                &ldquo;{rule.pattern}&rdquo;
                <button
                  onClick={() => removeFilterRule(rule.id)}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: colors.orange[400], padding: 0, fontSize: 14, lineHeight: 1,
                    display: "inline-flex", alignItems: "center",
                  }}
                >&times;</button>
              </span>
            ))}
            <input
              value={newBurnPattern}
              onChange={(e) => setNewBurnPattern(e.target.value.slice(0, 60))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newBurnPattern.trim()) {
                  addFilterRule({ field: "title", pattern: newBurnPattern.trim() });
                  setNewBurnPattern("");
                }
              }}
              placeholder="+ Add keyword"
              style={{
                width: 120, padding: `2px ${space[2]}px`,
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

        <div>
          <div style={subsectionLabel}>
            Quality Threshold: <span style={{ color: colors.cyan[400], fontFamily: fonts.mono }}>{profile.calibration.qualityThreshold.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={1} max={9} step={0.5}
            value={profile.calibration.qualityThreshold}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) setQualityThreshold(v); }}
            style={{ width: "100%", accentColor: colors.cyan[400], cursor: "pointer" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[1] }}>
            <span>More content</span>
            <span>Stricter filtering</span>
          </div>
        </div>

        <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[3], lineHeight: t.tiny.lineHeight }}>
          Changes apply in real time. Add topics to boost, block authors to suppress, set threshold to filter.
        </div>
      </div>

      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>D2A Social Agent</div>
        <AgentStatusBadge />
        {agentEnabled && (
          <div style={{ marginTop: space[3], display: "flex", flexWrap: "wrap", gap: mobile ? space[3] : space[4] }}>
            {[
              { label: "Min Score", value: MIN_OFFER_SCORE.toFixed(1), color: colors.purple[400] },
              { label: "Resonance", value: RESONANCE_THRESHOLD.toFixed(1), color: colors.sky[400] },
              { label: "Fee Range", value: `${(D2A_FEE_TRUSTED / 1e8).toFixed(4)}\u2013${(D2A_FEE_UNKNOWN / 1e8).toFixed(3)} ICP`, color: colors.amber[400] },
              { label: "Approval", value: `${(D2A_APPROVE_AMOUNT / 1e8).toFixed(1)} ICP`, color: colors.text.muted },
            ].map(p => (
              <div key={p.label} style={{ minWidth: 70 }}>
                <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginBottom: 2 }}>{p.label}</div>
                <div style={{ fontSize: t.caption.size, fontWeight: 700, fontFamily: fonts.mono, color: p.color }}>{p.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
