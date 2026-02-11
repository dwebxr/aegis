"use client";
import React, { useState, useEffect, useRef } from "react";
import { fonts } from "@/styles/theme";
import { ScoreRing } from "./ScoreRing";
import { scoreColor } from "@/lib/utils/scores";
import { formatICP, MIN_STAKE, MAX_STAKE } from "@/lib/ic/icpLedger";
import type { AnalyzeResponse } from "@/lib/types/api";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

interface SignalComposerProps {
  onPublish: (text: string, scores: AnalyzeResponse, stakeAmount?: bigint, imageUrl?: string) => Promise<{ eventId: string | null; relaysPublished: string[] }>;
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
  const [stakeE8s, setStakeE8s] = useState(1_000_000);

  // Image state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const result = await onPublish(text, selfScore, effectiveStake, imageUrl || undefined);
      setPublishResult(result);
    } finally {
      setIsPublishing(false);
    }
  };

  const rawMax = icpBalance != null
    ? Number(icpBalance < MAX_STAKE ? icpBalance : MAX_STAKE)
    : Number(MAX_STAKE);
  const maxStakeE8s = Math.max(rawMax, Number(MIN_STAKE));
  const hasBalance = icpBalance != null && icpBalance >= MIN_STAKE;

  useEffect(() => {
    if (stakeE8s > maxStakeE8s) {
      setStakeE8s(Math.max(Number(MIN_STAKE), maxStakeE8s));
    }
  }, [maxStakeE8s, stakeE8s]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageError(null);

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setImageError("Use JPEG, PNG, GIF, or WebP");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError(`Too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 5MB`);
      return;
    }

    const preview = URL.createObjectURL(file);
    setImagePreview(preview);
    setImageUrl(null);
    setSelfScore(null);

    setIsUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setImageError(data.error || "Upload failed");
        setImagePreview(null);
        URL.revokeObjectURL(preview);
      } else {
        setImageUrl(data.url);
      }
    } catch {
      setImageError("Upload failed — check connection");
      setImagePreview(null);
      URL.revokeObjectURL(preview);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setImageUrl(null);
    setImageError(null);
    setSelfScore(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleReset = () => {
    setText("");
    setSelfScore(null);
    setPublishResult(null);
    handleRemoveImage();
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

      {/* Image preview */}
      {imagePreview && (
        <div style={{ position: "relative", display: "inline-block", marginTop: 8 }}>
          <img
            src={imagePreview}
            alt="Attached"
            style={{ maxHeight: 120, maxWidth: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)" }}
          />
          {isUploading && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0.6)", borderRadius: 8, fontSize: 11, color: "#94a3b8", fontWeight: 600,
            }}>
              Uploading...
            </div>
          )}
          <button
            onClick={handleRemoveImage}
            style={{
              position: "absolute", top: 4, right: 4, width: 20, height: 20,
              background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "50%",
              color: "#f87171", fontSize: 12, cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center", lineHeight: 1,
            }}
          >
            &#x2715;
          </button>
        </div>
      )}

      {imageError && (
        <div style={{ fontSize: 10, color: "#f87171", marginTop: 4, fontWeight: 600 }}>{imageError}</div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            {text.length}/5000 characters
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleImageSelect}
            style={{ display: "none" }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title="Attach image"
            style={{
              background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
              padding: "3px 8px", cursor: isUploading ? "not-allowed" : "pointer", color: "#64748b",
              fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", gap: 4,
            }}
          >
            &#x1F4F7;
            {imageUrl && <span style={{ fontSize: 9, color: "#34d399" }}>&#x2713;</span>}
          </button>
        </div>

        {!selfScore ? (
          <button
            onClick={handleSelfEvaluate}
            disabled={!text.trim() || isAnalyzing || isUploading}
            style={{
              padding: mobile ? "10px 20px" : "10px 28px",
              background: text.trim() && !isAnalyzing && !isUploading
                ? "linear-gradient(135deg, #7c3aed, #2563eb)"
                : "rgba(255,255,255,0.05)",
              border: "none",
              borderRadius: 10,
              color: text.trim() && !isAnalyzing && !isUploading ? "#fff" : "#64748b",
              fontSize: 13,
              fontWeight: 700,
              cursor: text.trim() && !isAnalyzing && !isUploading ? "pointer" : "not-allowed",
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
                {isPublishing ? "Publishing..." : stakingEnabled ? `Deposit & Publish` : "Publish Signal"}
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
                    Quality Assurance Deposit
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
                    Deposit ICP as a quality assurance bond. Validated by community = deposit returned. Flagged = deposit forfeited as quality assurance cost. No verdict within 30 days = deposit auto-returned.
                  </div>
                  <div style={{ fontSize: 10, color: "#fbbf24", marginTop: 6, padding: "6px 8px", background: "rgba(251,191,36,0.08)", borderRadius: 6, lineHeight: 1.5 }}>
                    &#x26A0;&#xFE0F; Alpha &mdash; Currently in test operation. Bugs or data resets may occur. Please deposit only amounts you are comfortable treating as a tip. Refunds cannot be guaranteed if issues arise.
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
