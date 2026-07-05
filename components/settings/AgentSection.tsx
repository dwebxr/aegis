"use client";
import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAgent } from "@/contexts/AgentContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferenceContext";
import { BRIEFING_PUBLISH_ENABLED } from "@/lib/agent/config";
import { setPendingShareOff } from "@/lib/briefing/shareGate";
import { syncLinkedAccountToIC, getLinkedAccount, loadSettingsFromIC } from "@/lib/nostr/linkAccount";
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

const subsectionLabel = "text-caption text-disabled mb-2 font-semibold uppercase tracking-[0.5px]";

const pillChip = (colorClass: string) => cn(
  "inline-flex items-center gap-1 text-caption px-2 py-px rounded-full",
  colorClass
);

const pillRemoveBtn = (textColor: string) => cn(
  "bg-transparent border-none cursor-pointer p-0 text-sm leading-none inline-flex items-center",
  textColor
);

const tagInput = "w-[120px] px-2 py-px bg-transparent border border-border rounded-full text-secondary-foreground text-caption font-[inherit] outline-none";

const toggleBase = (on: boolean) => cn(
  "relative w-10 h-[22px] rounded-[11px] border-none cursor-pointer shrink-0 transition-fast",
  on ? "bg-cyan-500" : "bg-overlay"
);

const toggleKnob = (on: boolean): React.CSSProperties => ({
  position: "absolute", top: 2, left: on ? 20 : 2,
  width: 18, height: 18, borderRadius: "50%",
  background: on ? "#fff" : "var(--color-text-disabled)", /* dynamic JS value */
  transition: "left 0.15s ease",
});

export const AgentSection: React.FC<AgentSectionProps> = ({ mobile }) => {
  const { isEnabled: agentEnabled, briefingShareEnabled, setBriefingShareEnabled } = useAgent();
  const { isAuthenticated, identity, principalText } = useAuth();
  const {
    profile, setTopicAffinity, removeTopicAffinity,
    setQualityThreshold, addFilterRule, removeFilterRule,
  } = usePreferences();

  const [newTopic, setNewTopic] = useState("");
  const [newBlockedAuthor, setNewBlockedAuthor] = useState("");
  const [newBurnPattern, setNewBurnPattern] = useState("");
  const [shareSyncing, setShareSyncing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const handleBriefingShareToggle = useCallback(async () => {
    if (!identity || !principalText || shareSyncing) return;
    const next = !briefingShareEnabled;
    setShareSyncing(true);
    setShareError(null);
    // OFF: flip client state immediately so automatic publishing stops right
    // away even while the canister write (which purges the snapshot) is in
    // flight, and record the pending opt-out so a failed/interrupted write
    // can't silently revert to sharing-ON on the next load. ON: flip only
    // AFTER the canister accepted d2aEnabled=true — otherwise BriefingTab
    // would publish against a canister that rejects it.
    if (!next) {
      setBriefingShareEnabled(false);
      setPendingShareOff(principalText, true);
    }
    // saveUserSettings is a wholesale put: writing with a stale null local
    // account would wipe the on-chain linked Nostr account. Read the current
    // on-chain settings first and ABORT on a failed read — a null local
    // account can't tell us whether the canister holds one we couldn't see.
    // (OFF stays durable: local state is already off + the pending flag is
    // set, so restore retries the write on the next load.)
    const read = await loadSettingsFromIC(identity, principalText);
    if (!read.ok) {
      setShareError("Could not load current settings from the canister — try again.");
      setShareSyncing(false);
      return;
    }
    // No settings on-chain yet (first-time opt-in): the local account, if any,
    // is the only one that exists — safe to write.
    const account = read.settings ? read.settings.account : getLinkedAccount();
    const ok = await syncLinkedAccountToIC(identity, account, next);
    if (ok) {
      setPendingShareOff(principalText, false);
      if (next) setBriefingShareEnabled(true);
    } else {
      setShareError(next
        ? "Could not enable sharing on the canister. Try again."
        : "Sharing is off locally, but the public snapshot may not be purged yet — toggle again to retry.");
    }
    setShareSyncing(false);
  }, [identity, principalText, shareSyncing, briefingShareEnabled, setBriefingShareEnabled]);

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
              <div className="text-tiny text-disabled mb-0.5">{s.label}</div>
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
          <div className="flex justify-between text-tiny text-disabled mt-1">
            <span>More content</span>
            <span>Stricter filtering</span>
          </div>
        </div>

        <div className="text-tiny text-disabled mt-3 leading-normal">
          Changes apply in real time. Add topics to boost, block authors to suppress, set threshold to filter.
        </div>
      </div>

      {BRIEFING_PUBLISH_ENABLED && (
        <div className={cardClass(mobile)}>
          <div className={sectionTitleClass}>Public Briefing Sharing</div>
          <div className="flex items-center gap-2 mb-2">
            <button
              data-testid="aegis-settings-briefing-share-toggle"
              onClick={handleBriefingShareToggle}
              disabled={!isAuthenticated || shareSyncing}
              className={cn(toggleBase(briefingShareEnabled), (!isAuthenticated || shareSyncing) && "opacity-50 cursor-not-allowed")}
            >
              <div style={toggleKnob(briefingShareEnabled)} />
            </button>
            <span className={cn("text-caption font-semibold", briefingShareEnabled ? "text-cyan-400" : "text-disabled")}>
              {shareSyncing ? "Syncing…" : briefingShareEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          {shareError && (
            <div className="text-tiny text-red-400 mb-2">{shareError}</div>
          )}
          <div className="text-tiny text-disabled leading-normal">
            Publishes your briefing snapshot to the Internet Computer canister, where it is
            <span className="font-semibold"> publicly readable by anyone</span> — including
            paid API consumers of the global briefing feed. Turning this off deletes the
            public snapshot from the canister.
            {!isAuthenticated && " Sign in to change this setting."}
          </div>
        </div>
      )}

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
                <div className="text-tiny text-disabled mb-0.5">{p.label}</div>
                <div className={cn("text-caption font-bold font-mono", p.colorClass)}>{p.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
