"use client";
import React from "react";
import { IncineratorViz } from "@/components/ui/IncineratorViz";
import { ManualInput } from "@/components/sources/ManualInput";
import { SignalComposer } from "@/components/ui/SignalComposer";
import type { AnalyzeResponse } from "@/lib/types/api";

interface IncineratorTabProps {
  isProc: boolean;
  onAnalyze: (text: string) => Promise<AnalyzeResponse>;
  onPublishSignal?: (text: string, scores: AnalyzeResponse) => Promise<{ eventId: string | null; relaysPublished: string[] }>;
  isAnalyzing: boolean;
  nostrPubkey?: string | null;
  mobile?: boolean;
}

export const IncineratorTab: React.FC<IncineratorTabProps> = ({ isProc, onAnalyze, onPublishSignal, isAnalyzing, nostrPubkey, mobile }) => {
  const stages: Array<[string, string, boolean, string]> = [
    ["S1", "Semantic Dedup", isProc, "#818cf8"],
    ["S2", "Structural", isProc, "#38bdf8"],
    ["S3", "LLM Score", isProc, "#fbbf24"],
    ["S4", "Cross-Valid", false, "#94a3b8"],
  ];

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Slop Incinerator + Signal</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Evaluate content quality & publish your insights</p>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 18, padding: mobile ? 18 : 28, marginBottom: 18 }}>
        <IncineratorViz active={isProc} mobile={mobile} />
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 8, marginTop: 16 }}>
          {stages.map(([s, n, a, c]) => (
            <div key={s} style={{ textAlign: "center", padding: "10px 6px", background: "rgba(0,0,0,0.2)", borderRadius: 10 }}>
              <div style={{ fontSize: 9, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>{s}</div>
              <div style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600, marginTop: 3 }}>{n}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: c, marginTop: 4, textTransform: "uppercase", animation: a ? "pulse 1.5s infinite" : "none" }}>
                &#x25CF; {a ? "ACTIVE" : "IDLE"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 18, padding: mobile ? 18 : 28, marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 16 }}>Manual Analysis</div>
        <ManualInput onAnalyze={onAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />
      </div>

      {onPublishSignal && (
        <div style={{
          background: "linear-gradient(135deg, rgba(124,58,237,0.04), rgba(37,99,235,0.04))",
          border: "1px solid rgba(124,58,237,0.15)",
          borderRadius: 18,
          padding: mobile ? 18 : 28,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#c4b5fd", marginBottom: 4 }}>
            Publish Signal
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
            Share your thoughts with self-evaluation. Published to Nostr relays & IC canister.
          </div>
          <SignalComposer
            onPublish={onPublishSignal}
            onAnalyze={onAnalyze}
            isAnalyzing={isAnalyzing}
            nostrPubkey={nostrPubkey || null}
            mobile={mobile}
          />
        </div>
      )}
    </div>
  );
};
