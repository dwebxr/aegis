"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ZapIcon } from "@/components/icons";
import { ScoreBar } from "@/components/ui/ScoreBar";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { colors } from "@/styles/theme";
import type { AnalyzeResponse } from "@/lib/types/api";

interface ManualInputProps {
  onAnalyze: (text: string) => Promise<AnalyzeResponse>;
  isAnalyzing: boolean;
  mobile?: boolean;
}

export const ManualInput: React.FC<ManualInputProps> = ({ onAnalyze, isAnalyzing, mobile }) => {
  const [text, setText] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGo = async () => {
    if (!text.trim()) return;
    setResult(null);
    setError(null);
    try {
      const r = await onAnalyze(text);
      setResult(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const canAnalyze = text.trim() && !isAnalyzing;

  return (
    <div>
      <label className="block text-[10px] text-muted-foreground mb-1.5 uppercase tracking-[1px] font-semibold">
        Content to Evaluate
      </label>
      <textarea
        data-testid="aegis-manual-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste content here for AI quality analysis..."
        className="w-full h-[100px] bg-card border border-border rounded-xl px-3.5 py-3.5 text-secondary-foreground text-[13px] font-[inherit] resize-y outline-none box-border leading-[1.6]"
      />
      <div className="flex gap-2 mt-3 mb-4 items-end">
        <button
          data-testid="aegis-manual-analyze"
          onClick={handleGo}
          disabled={!canAnalyze}
          className={cn(
            "px-[22px] py-2.5 border-none rounded-[11px] text-white text-[13px] font-bold flex items-center gap-[7px] whitespace-nowrap justify-center",
            isAnalyzing ? "bg-sky-400/10" : "bg-gradient-to-br from-blue-600 to-blue-700",
            !canAnalyze ? "opacity-50 cursor-default" : "cursor-pointer",
            mobile ? "w-full" : "w-auto"
          )}
        >
          {isAnalyzing ? (
            <><span className="inline-block animate-spin">&#x27F3;</span> Analyzing...</>
          ) : (
            <><ZapIcon s={15} /> Analyze</>
          )}
        </button>
      </div>

      {error && (
        <div data-testid="aegis-manual-error" className="text-body-sm text-red-400 mb-3 font-semibold">
          Analysis failed: {error}
        </div>
      )}

      {result && (
        <div
          data-testid="aegis-manual-result"
          className={cn(
            "rounded-[14px] animate-fade-in",
            result.verdict === "quality"
              ? "bg-emerald-400/5 border border-emerald-400/20"
              : "bg-red-400/5 border border-red-400/20",
            mobile ? "p-4" : "p-[22px]"
          )}
        >
          <div className="flex justify-between items-center mb-3.5 gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[22px]">{result.verdict === "quality" ? "\u2705" : "\uD83D\uDD25"}</span>
              <div>
                <div data-testid="aegis-manual-verdict" className={cn(
                  "text-sm font-extrabold uppercase",
                  result.verdict === "quality" ? "text-green-400" : "text-red-400"
                )}>
                  {result.verdict === "quality" ? "Quality" : "Slop"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {result.verdict === "quality" ? "Quality confirmed" : "Slop identified"}
                </div>
              </div>
            </div>
            <ScoreRing value={result.composite} size={50} color={result.verdict === "quality" ? colors.green[400] : colors.red[400]} />
          </div>
          <div className={cn("grid grid-cols-3 gap-2.5", result.reason ? "mb-3" : "")}>
            <ScoreBar label="Originality" score={result.originality} color="#818cf8" />
            <ScoreBar label="Insight" score={result.insight} color="#38bdf8" />
            <ScoreBar label="Credibility" score={result.credibility} color="#34d399" />
          </div>
          {result.reason && (
            <div className="text-body-sm text-[var(--color-text-tertiary)] leading-[1.5] italic bg-black/20 px-3 py-[9px] rounded-[9px]">
              {result.reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
