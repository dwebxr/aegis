"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
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
import { cardClass, sectionTitleClass } from "./styles";

interface AgentSectionProps {
  mobile?: boolean;
}

const subsectionLabel = "text-caption text-[var(--color-text-disabled)] mb-2 font-semibold uppercase tracking-[0.5px]";

const pillChip = (colorClass: string) => cn(
  "inline-flex items-center gap-1 text-caption px-2 py-px rounded-full",
  colorClass
);

const pillRemoveBtn = (textColor: string) => cn(
  "bg-transparent border-none cursor-pointer p-0 text-sm leading-none inline-flex items-center",
  textColor
);

const tagInput = "w-[120px] px-2 py-px bg-transparent border border-border rounded-full text-secondary-foreground text-caption font-[inherit] outline-none";

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

  const AGENT_PARAMS = [
    { label: "Interests", value: String(interests.length), colorClass: "text-cyan-400" },
    { label: "Threshold", value: profile.calibration.qualityThreshold.toFixed(1), colorClass: "text-cyan-400" },
    { label: "Reviews", value: String(profile.totalValidated + profile.totalFlagged), colorClass: "text-secondary-foreground" },
  ];

  return (
    <>
      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Agent Preferences</div>
        <div className="flex gap-4 mb-4 flex-wrap">
          {AGENT_PARAMS.map(s => (
            <div key={s.label}>
              <div className="text-tiny text-[var(--color-text-disabled)] mb-0.5">{s.label}</div>
              <div className={cn("text-caption font-bold font-mono", s.colorClass)}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="mb-4">
          <div className={subsectionLabel}>Interests</div>
          <div className="flex flex-wrap gap-2 items-center">
            {interests.map(([topic]) => (
              <span key={topic} className={pillChip("bg-cyan-400/[0.06] border border-cyan-400/[0.12] text-cyan-400")}>
                {topic}
                <button
                  onClick={() => removeTopicAffinity(topic)}
                  className={pillRemoveBtn("text-cyan-400")}
                >&times;</button>
              </span>
            ))}
            <input
              data-testid="aegis-settings-interest-input"
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
              className={cn(tagInput, "w-[100px]")}
            />
          </div>
        </div>

        <div className="mb-4">
          <div className={subsectionLabel}>Blocked Authors</div>
          <div className="flex flex-wrap gap-2 items-center">
            {authorRules.map(rule => (
              <span key={rule.id} className={pillChip("bg-red-400/[0.06] border border-red-400/[0.12] text-red-400")}>
                {rule.pattern}
                <button
                  onClick={() => removeFilterRule(rule.id)}
                  className={pillRemoveBtn("text-red-400")}
                >&times;</button>
              </span>
            ))}
            <input
              data-testid="aegis-settings-blocked-author-input"
              value={newBlockedAuthor}
              onChange={(e) => setNewBlockedAuthor(e.target.value.slice(0, 60))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newBlockedAuthor.trim()) {
                  addFilterRule({ field: "author", pattern: newBlockedAuthor.trim() });
                  setNewBlockedAuthor("");
                }
              }}
              placeholder="+ Block author"
              className={tagInput}
            />
          </div>
        </div>

        <div className="mb-4">
          <div className={subsectionLabel}>Burn Patterns</div>
          <div className="flex flex-wrap gap-2 items-center">
            {titleRules.map(rule => (
              <span key={rule.id} className={pillChip("bg-orange-400/[0.06] border border-orange-400/[0.12] text-orange-400")}>
                &ldquo;{rule.pattern}&rdquo;
                <button
                  onClick={() => removeFilterRule(rule.id)}
                  className={pillRemoveBtn("text-orange-400")}
                >&times;</button>
              </span>
            ))}
            <input
              data-testid="aegis-settings-burn-pattern-input"
              value={newBurnPattern}
              onChange={(e) => setNewBurnPattern(e.target.value.slice(0, 60))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newBurnPattern.trim()) {
                  addFilterRule({ field: "title", pattern: newBurnPattern.trim() });
                  setNewBurnPattern("");
                }
              }}
              placeholder="+ Add keyword"
              className={tagInput}
            />
          </div>
        </div>

        <div>
          <div className={subsectionLabel}>
            Quality Threshold: <span className="text-cyan-400 font-mono">{profile.calibration.qualityThreshold.toFixed(1)}</span>
          </div>
          <input
            data-testid="aegis-settings-quality-threshold"
            type="range"
            min={1} max={9} step={0.5}
            value={profile.calibration.qualityThreshold}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) setQualityThreshold(v); }}
            className="w-full cursor-pointer"
            style={{ accentColor: "var(--color-cyan-400, #22d3ee)" }}
          />
          <div className="flex justify-between text-tiny text-[var(--color-text-disabled)] mt-1">
            <span>More content</span>
            <span>Stricter filtering</span>
          </div>
        </div>

        <div className="text-tiny text-[var(--color-text-disabled)] mt-3 leading-normal">
          Changes apply in real time. Add topics to boost, block authors to suppress, set threshold to filter.
        </div>
      </div>

      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>D2A Social Agent</div>
        <AgentStatusBadge />
        {agentEnabled && (
          <div className={cn("mt-3 flex flex-wrap", mobile ? "gap-3" : "gap-4")}>
            {[
              { label: "Min Score", value: MIN_OFFER_SCORE.toFixed(1), colorClass: "text-purple-400" },
              { label: "Resonance", value: RESONANCE_THRESHOLD.toFixed(1), colorClass: "text-sky-400" },
              { label: "Fee Range", value: `${(D2A_FEE_TRUSTED / 1e8).toFixed(4)}\u2013${(D2A_FEE_UNKNOWN / 1e8).toFixed(3)} ICP`, colorClass: "text-amber-400" },
              { label: "Approval", value: `${(D2A_APPROVE_AMOUNT / 1e8).toFixed(1)} ICP`, colorClass: "text-muted-foreground" },
            ].map(p => (
              <div key={p.label} className="min-w-[70px]">
                <div className="text-tiny text-[var(--color-text-disabled)] mb-0.5">{p.label}</div>
                <div className={cn("text-caption font-bold font-mono", p.colorClass)}>{p.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
