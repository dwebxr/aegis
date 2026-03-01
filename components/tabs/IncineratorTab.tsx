"use client";
import React from "react";
import { IncineratorViz } from "@/components/ui/IncineratorViz";
import { ManualInput } from "@/components/sources/ManualInput";
import { SignalComposer } from "@/components/ui/SignalComposer";
import { colors, space, type as t, radii, kpiLabelStyle } from "@/styles/theme";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { PublishGateDecision } from "@/lib/reputation/publishGate";

interface IncineratorTabProps {
  isAnalyzing: boolean;
  onAnalyze: (text: string) => Promise<AnalyzeResponse>;
  onPublishSignal?: (text: string, scores: AnalyzeResponse, stakeAmount?: bigint, imageUrl?: string) => Promise<{ eventId: string | null; relaysPublished: string[] }>;
  onUploadImage?: (file: File) => Promise<{ url?: string; error?: string }>;
  nostrPubkey?: string | null;
  icpBalance?: bigint | null;
  stakingEnabled?: boolean;
  publishGate?: PublishGateDecision | null;
  mobile?: boolean;
}

const STAGES = [
  { id: "S1", name: "Heuristic Filter", activatable: true, color: colors.purple[400] },
  { id: "S2", name: "Structural", activatable: true, color: colors.sky[400] },
  { id: "S3", name: "LLM Score", activatable: true, color: colors.amber[400] },
  { id: "S4", name: "Cross-Valid", activatable: false, color: colors.text.tertiary },
] as const;

export const IncineratorTab: React.FC<IncineratorTabProps> = ({ isAnalyzing, onAnalyze, onPublishSignal, onUploadImage, nostrPubkey, icpBalance, stakingEnabled, publishGate, mobile }) => {
  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: mobile ? space[8] : space[12] }}>
        <h1 data-testid="aegis-incinerator-heading" style={{
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

      {onPublishSignal && (
        <div style={{
          background: `linear-gradient(135deg, rgba(124,58,237,0.04), rgba(37,99,235,0.04))`,
          border: `1px solid rgba(124,58,237,0.15)`,
          borderRadius: radii.xl,
          padding: mobile ? space[5] : space[8],
          marginBottom: mobile ? space[8] : space[12],
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
            onUploadImage={onUploadImage}
            isAnalyzing={isAnalyzing}
            nostrPubkey={nostrPubkey || null}
            icpBalance={icpBalance}
            stakingEnabled={stakingEnabled}
            publishGate={publishGate}
            mobile={mobile}
          />
        </div>
      )}

      {!onPublishSignal && (
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
      )}

      <div style={{
        background: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radii.xl,
        padding: mobile ? space[5] : space[8],
        animation: isAnalyzing ? "glowPulse 2s infinite" : "none",
      }}>
        <IncineratorViz active={isAnalyzing} mobile={mobile} />
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: space[2], marginTop: space[4] }}>
          {STAGES.map(({ id, name, activatable, color }) => {
            const active = activatable && isAnalyzing;
            return (
              <div key={id} style={{ textAlign: "center", padding: `${space[3]}px ${space[2]}px`, background: colors.bg.raised, borderRadius: radii.sm }}>
                <div style={{ ...kpiLabelStyle, letterSpacing: 1 }}>{id}</div>
                <div style={{ fontSize: t.bodySm.size, color: colors.text.secondary, fontWeight: 600, marginTop: space[1] }}>{name}</div>
                <div style={{ fontSize: t.tiny.size, fontWeight: 700, color, marginTop: space[1], textTransform: "uppercase", animation: active ? "pulse 1.5s infinite" : "none" }}>
                  &#x25CF; {active ? "ACTIVE" : "IDLE"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
