"use client";
import React from "react";
import { IncineratorViz } from "@/components/ui/IncineratorViz";
import { ManualInput } from "@/components/sources/ManualInput";
import { SignalComposer } from "@/components/ui/SignalComposer";
import { colors, space, type as t, radii, kpiLabelStyle } from "@/styles/theme";
import type { AnalyzeResponse } from "@/lib/types/api";

interface IncineratorTabProps {
  isAnalyzing: boolean;
  onAnalyze: (text: string) => Promise<AnalyzeResponse>;
  onPublishSignal?: (text: string, scores: AnalyzeResponse) => Promise<{ eventId: string | null; relaysPublished: string[] }>;
  nostrPubkey?: string | null;
  mobile?: boolean;
}

export const IncineratorTab: React.FC<IncineratorTabProps> = ({ isAnalyzing, onAnalyze, onPublishSignal, nostrPubkey, mobile }) => {
  const stages: Array<[string, string, boolean, string]> = [
    ["S1", "Heuristic Filter", isAnalyzing, colors.purple[400]],
    ["S2", "Structural", isAnalyzing, colors.sky[400]],
    ["S3", "LLM Score", isAnalyzing, colors.amber[400]],
    ["S4", "Cross-Valid", false, colors.text.tertiary],
  ];

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
          Slop Incinerator + Signal
        </h1>
        <p style={{ fontSize: mobile ? t.body.mobileSz : t.body.size, color: colors.text.muted, marginTop: space[2] }}>
          Evaluate content quality & publish your insights
        </p>
      </div>

      <div style={{
        background: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radii.xl,
        padding: mobile ? space[5] : space[8],
        marginBottom: mobile ? space[8] : space[12],
        animation: isAnalyzing ? "glowPulse 2s infinite" : "none",
      }}>
        <IncineratorViz active={isAnalyzing} mobile={mobile} />
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: space[2], marginTop: space[4] }}>
          {stages.map(([s, n, a, c]) => (
            <div key={s} style={{ textAlign: "center", padding: `${space[3]}px ${space[2]}px`, background: colors.bg.raised, borderRadius: radii.sm }}>
              <div style={{ ...kpiLabelStyle, letterSpacing: 1 }}>{s}</div>
              <div style={{ fontSize: t.bodySm.size, color: colors.text.secondary, fontWeight: 600, marginTop: space[1] }}>{n}</div>
              <div style={{ fontSize: t.tiny.size, fontWeight: 700, color: c, marginTop: space[1], textTransform: "uppercase", animation: a ? "pulse 1.5s infinite" : "none" }}>
                &#x25CF; {a ? "ACTIVE" : "IDLE"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        background: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radii.xl,
        padding: mobile ? space[5] : space[8],
        marginBottom: mobile ? space[8] : space[12],
      }}>
        <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.secondary, marginBottom: space[4] }}>Manual Analysis</div>
        <ManualInput onAnalyze={onAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />
      </div>

      {onPublishSignal && (
        <div style={{
          background: `linear-gradient(135deg, rgba(124,58,237,0.04), rgba(37,99,235,0.04))`,
          border: `1px solid rgba(124,58,237,0.15)`,
          borderRadius: radii.xl,
          padding: mobile ? space[5] : space[8],
        }}>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.purple[400], marginBottom: space[1] }}>
            Publish Signal
          </div>
          <div style={{ fontSize: t.bodySm.size, color: colors.text.muted, marginBottom: space[4] }}>
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
