"use client";
import React, { useState } from "react";
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

  return (
    <div>
      <label style={{ display: "block", fontSize: 10, color: colors.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>
        Content to Evaluate
      </label>
      <textarea
        data-testid="aegis-manual-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste content here for AI quality analysis..."
        style={{
          width: "100%", height: 100, background: colors.bg.surface,
          border: `1px solid ${colors.border.default}`, borderRadius: 12,
          padding: 14, color: colors.text.secondary, fontSize: 13, fontFamily: "inherit",
          resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.6,
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 16, alignItems: "flex-end" }}>
        <button
          data-testid="aegis-manual-analyze"
          onClick={handleGo}
          disabled={isAnalyzing || !text.trim()}
          style={{
            padding: "10px 22px",
            background: isAnalyzing ? "rgba(56,189,248,0.1)" : "linear-gradient(135deg,#2563eb,#1d4ed8)",
            border: "none", borderRadius: 11, color: "#fff", fontSize: 13,
            fontWeight: 700, cursor: isAnalyzing ? "default" : "pointer",
            display: "flex", alignItems: "center", gap: 7,
            opacity: (!text.trim() || isAnalyzing) ? 0.5 : 1,
            whiteSpace: "nowrap", width: mobile ? "100%" : "auto", justifyContent: "center",
          }}
        >
          {isAnalyzing ? (
            <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>&#x27F3;</span> Analyzing...</>
          ) : (
            <><ZapIcon s={15} /> Analyze</>
          )}
        </button>
      </div>

      {error && (
        <div data-testid="aegis-manual-error" style={{ fontSize: 12, color: colors.red[400], marginBottom: 12, fontWeight: 600 }}>
          Analysis failed: {error}
        </div>
      )}

      {result && (
        <div data-testid="aegis-manual-result" style={{
          background: result.verdict === "quality" ? "rgba(52,211,153,0.05)" : "rgba(248,113,113,0.05)",
          border: `1px solid ${result.verdict === "quality" ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
          borderRadius: 14, padding: mobile ? 16 : 22, animation: "fadeIn .5s ease",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 22 }}>{result.verdict === "quality" ? "✅" : "🔥"}</span>
              <div>
                <div data-testid="aegis-manual-verdict" style={{ fontSize: 14, fontWeight: 800, color: result.verdict === "quality" ? colors.green[400] : colors.red[400], textTransform: "uppercase" }}>
                  {result.verdict === "quality" ? "Quality" : "Slop"}
                </div>
                <div style={{ fontSize: 11, color: colors.text.muted }}>
                  {result.verdict === "quality" ? "Quality confirmed" : "Slop identified"}
                </div>
              </div>
            </div>
            <ScoreRing value={result.composite} size={50} color={result.verdict === "quality" ? colors.green[400] : colors.red[400]} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: result.reason ? 12 : 0 }}>
            <ScoreBar label="Originality" score={result.originality} color="#818cf8" />
            <ScoreBar label="Insight" score={result.insight} color="#38bdf8" />
            <ScoreBar label="Credibility" score={result.credibility} color="#34d399" />
          </div>
          {result.reason && (
            <div style={{ fontSize: 12, color: colors.text.tertiary, lineHeight: 1.5, fontStyle: "italic", background: "rgba(0,0,0,0.2)", padding: "9px 12px", borderRadius: 9 }}>
              {result.reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
