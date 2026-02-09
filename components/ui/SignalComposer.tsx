"use client";
import React, { useState, useEffect } from "react";
import { fonts } from "@/styles/theme";
import { ScoreRing } from "./ScoreRing";
import { scoreColor } from "@/lib/utils/scores";
import { formatICP, MIN_STAKE, MAX_STAKE } from "@/lib/ic/icpLedger";
import type { AnalyzeResponse } from "@/lib/types/api";

interface SignalComposerProps {
  onPublish: (text: string, scores: AnalyzeResponse, stakeAmount?: bigint) => Promise<{ eventId: string | null; relaysPublished: string[] }>;
  onAnalyze: (text: string) => Promise<AnalyzeResponse>;
  isAnalyzing: boolean;
  nostrPubkey: string | null;
  icpBalance?: bigint | null;
  stakingEnabled?: boolean;
  mobile?: boolean;
}

export const SignalComposer: React.FC<SignalComposerProps> = ({ onPublish, onAnalyze, isAnalyzing, nostrPubkey, icpBalance, stakingEnabled, mobile }) => {
  const [text, setText] = useState("");
  const [selfScore, setSelfScore] = useState<AnalyzeResponse | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ eventId: string | null; relaysPublished: string[] } | null>(null);
  // Slider value in e8s steps: 100_000 (0.001) to 100_000_000 (1.0)
  const [stakeE8s, setStakeE8s] = useState(1_000_000); // Default: 0.01 ICP

  const handleSelfEvaluate = async () => {
    if (!text.trim()) return;
    const result = await onAnalyze(text);
    setSelfScore(result);
  };

  const effectiveStake = stakingEnabled ? BigInt(stakeE8s) : undefined;

  const handlePublish = async () => {
    if (!selfScore) return;
    setIsPublishing(true);
    try {
      const result = await onPublish(text, selfScore, effectiveStake);
      setPublishResult(result);
    } finally {
      setIsPublishing(false);
    }
  };

  const maxStakeE8s = icpBalance != null
    ? Number(icpBalance < MAX_STAKE ? icpBalance : MAX_STAKE)
    : Number(MAX_STAKE);
  const hasBalance = icpBalance != null && icpBalance >= MIN_STAKE;

  // Clamp stakeE8s when max changes (e.g. balance drops)
  useEffect(() => {
    if (stakeE8s > maxStakeE8s) {
      setStakeE8s(Math.max(Number(MIN_STAKE), maxStakeE8s));
    }
  }, [maxStakeE8s, stakeE8s]);

  const handleReset = () => {
    setText("");
    setSelfScore(null);
    setPublishResult(null);
  };

  if (publishResult) {
    return (
      <div style={{ textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>&#x1F4E1;</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#34d399", marginBottom: 8 }}>Signal Published</div>
        {publishResult.eventId && (
          <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 12 }}>
            Event: {publishResult.eventId.slice(0, 16)}...
          </div>
        )}
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
          Published to {publishResult.relaysPublished.length} relay{publishResult.relaysPublished.length !== 1 ? "s" : ""}
        </div>
        <button onClick={handleReset} style={{
          padding: "10px 24px", background: "rgba(37,99,235,0.15)",
          border: "1px solid rgba(37,99,235,0.3)", borderRadius: 10,
          color: "#60a5fa", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
          Compose Another
        </button>
      </div>
    );
  }

  return (
    <div>
      {nostrPubkey && (
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 10, fontFamily: fonts.mono }}>
          Nostr: {nostrPubkey.slice(0, 12)}...{nostrPubkey.slice(-8)}
        </div>
      )}

      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setSelfScore(null); }}
        placeholder="Share your signal — analysis, findings, insights..."
        style={{
          width: "100%",
          minHeight: 120,
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 14,
          color: "#e2e8f0",
          fontSize: 14,
          lineHeight: 1.6,
          fontFamily: "inherit",
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, color: "#64748b" }}>
          {text.length}/5000 characters
        </div>

        {!selfScore ? (
          <button
            onClick={handleSelfEvaluate}
            disabled={!text.trim() || isAnalyzing}
            style={{
              padding: mobile ? "10px 20px" : "10px 28px",
              background: text.trim() && !isAnalyzing
                ? "linear-gradient(135deg, #7c3aed, #2563eb)"
                : "rgba(255,255,255,0.05)",
              border: "none",
              borderRadius: 10,
              color: text.trim() && !isAnalyzing ? "#fff" : "#64748b",
              fontSize: 13,
              fontWeight: 700,
              cursor: text.trim() && !isAnalyzing ? "pointer" : "not-allowed",
            }}
          >
            {isAnalyzing ? "Evaluating..." : "Self-Evaluate"}
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <ScoreRing value={selfScore.composite} size={40} color={scoreColor(selfScore.composite)} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: selfScore.verdict === "quality" ? "#34d399" : "#f87171", textTransform: "uppercase" }}>
                  {selfScore.verdict}
                </div>
                {selfScore.topics && selfScore.topics.length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                    {selfScore.topics.map(t => (
                      <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "rgba(139,92,246,0.12)", color: "#a78bfa", fontWeight: 600 }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handlePublish}
                disabled={isPublishing || (stakingEnabled && !hasBalance)}
                style={{
                  padding: mobile ? "10px 16px" : "10px 24px",
                  background: isPublishing || (stakingEnabled && !hasBalance)
                    ? "rgba(255,255,255,0.05)"
                    : stakingEnabled
                      ? "linear-gradient(135deg, #f59e0b, #ef4444)"
                      : "linear-gradient(135deg, #34d399, #2563eb)",
                  border: "none",
                  borderRadius: 10,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: isPublishing || (stakingEnabled && !hasBalance) ? "not-allowed" : "pointer",
                  marginLeft: "auto",
                }}
              >
                {isPublishing ? "Publishing..." : stakingEnabled ? `Stake & Publish` : "Publish Signal"}
              </button>
            </div>

            {stakingEnabled && (
              <div style={{
                background: "rgba(245,158,11,0.06)",
                border: "1px solid rgba(245,158,11,0.15)",
                borderRadius: 10,
                padding: "10px 14px",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
                    Proof of Quality Stake (Required)
                  </span>
                  {icpBalance != null && (
                    <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>
                      Balance: {formatICP(icpBalance)} ICP
                    </span>
                  )}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="range"
                      min={Number(MIN_STAKE)}
                      max={maxStakeE8s}
                      step={100_000}
                      value={stakeE8s}
                      onChange={e => setStakeE8s(Number(e.target.value))}
                      style={{ flex: 1, accentColor: "#f59e0b" }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", fontFamily: fonts.mono, minWidth: 80, textAlign: "right" }}>
                      {formatICP(BigInt(stakeE8s))} ICP
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                    Stake ICP to back your signal. Validated = returned + trust. Flagged as slop = slashed.
                  </div>
                  {!hasBalance && (
                    <div style={{ fontSize: 10, color: "#f87171", marginTop: 4, fontWeight: 600 }}>
                      Insufficient ICP balance. Min: {formatICP(MIN_STAKE)} ICP
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
