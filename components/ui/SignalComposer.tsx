"use client";
import React, { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ScoreRing } from "./ScoreRing";
import { scoreColor } from "@/lib/utils/scores";
import { formatICP, MIN_STAKE, MAX_STAKE } from "@/lib/ic/icpLedger";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { PublishGateDecision } from "@/lib/reputation/publishGate";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

interface SignalComposerProps {
  onPublish: (text: string, scores: AnalyzeResponse, stakeAmount?: bigint, imageUrl?: string) => Promise<{ eventId: string | null; relaysPublished: string[] }>;
  onAnalyze: (text: string) => Promise<AnalyzeResponse>;
  onUploadImage?: (file: File) => Promise<{ url?: string; error?: string }>;
  isAnalyzing: boolean;
  nostrPubkey: string | null;
  icpBalance?: bigint | null;
  stakingEnabled?: boolean;
  publishGate?: PublishGateDecision | null;
  mobile?: boolean;
}

export const SignalComposer: React.FC<SignalComposerProps> = ({ onPublish, onAnalyze, onUploadImage, isAnalyzing, nostrPubkey, icpBalance, stakingEnabled, publishGate, mobile }) => {
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

  const [evalError, setEvalError] = useState<string | null>(null);

  const handleSelfEvaluate = async () => {
    if (!text.trim()) return;
    setEvalError(null);
    try {
      const result = await onAnalyze(text);
      setSelfScore(result);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : String(err));
    }
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
  const isGateBlocked = publishGate != null && !publishGate.canPublish;

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
      if (onUploadImage) {
        const result = await onUploadImage(file);
        if (result.error) {
          setImageError(result.error);
          setImagePreview(null);
          URL.revokeObjectURL(preview);
        } else if (result.url) {
          setImageUrl(result.url);
        }
      } else {
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

  const canEval = text.trim() && !isAnalyzing && !isUploading;
  const canPublish = !isPublishing && !isGateBlocked && !(stakingEnabled && !hasBalance);

  if (publishResult) {
    return (
      <div className="text-center p-6">
        <div className="text-[40px] mb-3">&#x1F4E1;</div>
        <div className="text-lg font-bold text-green-400 mb-2">Signal Published</div>
        {publishResult.eventId && (
          <div className="text-kpi-sub text-muted-foreground font-mono mb-3">
            Event: {publishResult.eventId.slice(0, 16)}...
          </div>
        )}
        <div className="text-body-sm text-tertiary mb-4">
          Published to {publishResult.relaysPublished.length} relay{publishResult.relaysPublished.length !== 1 ? "s" : ""}
        </div>
        <button onClick={handleReset} className="px-6 py-2.5 bg-blue-600/15 border border-blue-600/30 rounded-[10px] text-blue-400 text-[13px] font-semibold cursor-pointer">
          Compose Another
        </button>
      </div>
    );
  }

  return (
    <div>
      {nostrPubkey && (
        <div className="text-caption text-muted-foreground mb-2.5 font-mono">
          Nostr: {nostrPubkey.slice(0, 12)}...{nostrPubkey.slice(-8)}
        </div>
      )}

      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setSelfScore(null); setEvalError(null); }}
        placeholder="Share your signal — analysis, findings, insights..."
        className="w-full min-h-[120px] bg-black/30 border border-border rounded-xl px-3.5 py-3.5 text-secondary-foreground text-sm leading-[1.6] font-[inherit] resize-y outline-none box-border"
      />

      {/* Image preview */}
      {imagePreview && (
        <div className="relative inline-block mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview URL */}
          <img
            src={imagePreview}
            alt="Attached"
            className="max-h-[120px] max-w-full rounded-lg border border-white/10"
          />
          {isUploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg text-kpi-sub text-tertiary font-semibold">
              Uploading...
            </div>
          )}
          <button
            onClick={handleRemoveImage}
            className="absolute top-1 right-1 size-5 bg-black/70 border-none rounded-full text-red-400 text-xs cursor-pointer flex items-center justify-center leading-none"
          >
            &#x2715;
          </button>
        </div>
      )}

      {imageError && (
        <div className="text-caption text-red-400 mt-1 font-semibold">{imageError}</div>
      )}

      <div className="flex items-center justify-between mt-3 gap-2.5 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="text-caption text-muted-foreground">
            {text.length}/5000 characters
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleImageSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title="Attach image"
            className={cn(
              "bg-transparent border border-emphasis rounded-md px-2 py-[3px] text-muted-foreground text-sm leading-none flex items-center gap-1",
              isUploading ? "cursor-not-allowed" : "cursor-pointer"
            )}
          >
            &#x1F4F7;
            {imageUrl && <span className="text-tiny text-green-400">&#x2713;</span>}
          </button>
        </div>

        {!selfScore ? (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleSelfEvaluate}
              disabled={!canEval}
              className={cn(
                "border-none rounded-[10px] text-[13px] font-bold",
                mobile ? "px-5 py-2.5" : "px-7 py-2.5",
                canEval
                  ? "bg-gradient-to-br from-violet-600 to-blue-600 text-white cursor-pointer"
                  : "bg-white/5 text-muted-foreground cursor-not-allowed"
              )}
            >
              {isAnalyzing ? "Evaluating..." : "Self-Evaluate"}
            </button>
            {evalError && (
              <div className="text-caption text-red-400 font-semibold">
                {evalError}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 flex-1">
            <div className="flex items-center gap-3">
              <ScoreRing value={selfScore.composite} size={40} color={scoreColor(selfScore.composite)} />
              <div>
                <div className={cn(
                  "text-kpi-sub font-bold uppercase",
                  selfScore.verdict === "quality" ? "text-green-400" : "text-red-400"
                )}>
                  {selfScore.verdict}
                </div>
                {selfScore.topics && selfScore.topics.length > 0 && (
                  <div className="flex gap-1 mt-[3px]">
                    {selfScore.topics.map(t => (
                      <span key={t} className="text-tiny px-1.5 py-px rounded-lg bg-violet-500/[0.12] text-purple-400 font-semibold">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handlePublish}
                disabled={!canPublish}
                className={cn(
                  "border-none rounded-[10px] text-[13px] font-bold text-white ml-auto",
                  mobile ? "px-4 py-2.5" : "px-6 py-2.5",
                  !canPublish
                    ? "bg-white/5 cursor-not-allowed"
                    : stakingEnabled
                      ? "bg-gradient-to-br from-amber-500 to-red-500 cursor-pointer"
                      : "bg-gradient-to-br from-emerald-400 to-blue-600 cursor-pointer"
                )}
              >
                {isPublishing ? "Publishing..." : isGateBlocked ? "Publishing Suspended" : stakingEnabled ? `Deposit & Publish` : "Publish Signal"}
              </button>
            </div>

            {isGateBlocked && (
              <div className="text-kpi-sub text-red-400 mt-1 px-3 py-2 bg-red-400/[0.06] rounded-lg font-semibold leading-body-sm">
                Publishing is suspended. Your published signals have been repeatedly flagged. Reputation recovers +1 per week of inactivity.
              </div>
            )}

            {publishGate && !publishGate.requiresDeposit && publishGate.canPublish && publishGate.reason && (
              <div className="text-caption text-muted-foreground mt-1 italic">
                {publishGate.reason}
              </div>
            )}

            {stakingEnabled && (
              <div className="bg-amber-500/[0.06] border border-amber-500/15 rounded-[10px] px-3.5 py-2.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-body-sm text-amber-500 font-semibold">
                    Quality Assurance Deposit
                  </span>
                  {icpBalance != null && (
                    <span className="text-caption text-muted-foreground font-mono">
                      Balance: {formatICP(icpBalance)} ICP
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2.5">
                    <input
                      type="range"
                      min={Number(MIN_STAKE)}
                      max={maxStakeE8s}
                      step={100_000}
                      value={stakeE8s}
                      onChange={e => setStakeE8s(Number(e.target.value))}
                      className="flex-1 accent-amber-500"
                    />
                    <span className="text-[13px] font-bold text-amber-500 font-mono min-w-[80px] text-right">
                      {formatICP(BigInt(stakeE8s))} ICP
                    </span>
                  </div>
                  <div className="text-caption text-tertiary mt-1">
                    Deposit ICP as a quality assurance bond. Validated by community = deposit returned. Flagged = deposit forfeited as quality assurance cost. No verdict within 30 days = deposit auto-returned.
                  </div>
                  <div className="text-caption text-amber-400 mt-1.5 px-2 py-1.5 bg-amber-dim rounded-md leading-body-sm">
                    &#x26A0;&#xFE0F; Alpha &mdash; Currently in test operation. Bugs or data resets may occur. Please deposit only amounts you are comfortable treating as a tip. Refunds cannot be guaranteed if issues arise.
                  </div>
                  {!hasBalance && (
                    <div className="text-caption text-red-400 mt-1 font-semibold">
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
