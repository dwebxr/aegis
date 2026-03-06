"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/design";
import { IncineratorViz } from "@/components/ui/IncineratorViz";
import { ManualInput } from "@/components/sources/ManualInput";
import { SignalComposer } from "@/components/ui/SignalComposer";
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
  { id: "S1", name: "Heuristic Filter", activatable: true, colorClass: "text-purple-400" },
  { id: "S2", name: "Structural", activatable: true, colorClass: "text-sky-400" },
  { id: "S3", name: "LLM Score", activatable: true, colorClass: "text-amber-400" },
  { id: "S4", name: "Cross-Valid", activatable: false, colorClass: "text-[var(--color-text-tertiary)]" },
] as const;

export const IncineratorTab: React.FC<IncineratorTabProps> = ({ isAnalyzing, onAnalyze, onPublishSignal, onUploadImage, nostrPubkey, icpBalance, stakingEnabled, publishGate, mobile }) => {
  return (
    <div className="animate-fade-in">
      <div className={mobile ? "mb-8" : "mb-12"}>
        <h1 data-testid="aegis-incinerator-heading" className={cn(
          typography.display,
          "text-foreground m-0",
          mobile && "text-[24px]"
        )}>
          Slop Incinerator + Signal
        </h1>
        <p className={cn("text-muted-foreground mt-2", mobile ? "text-[13px]" : "text-body")}>
          Evaluate content quality &amp; publish your insights
        </p>
      </div>

      {onPublishSignal && (
        <div className={cn(
          "bg-gradient-to-br from-purple-600/[0.04] to-blue-600/[0.04] border border-purple-600/15 rounded-xl",
          mobile ? "p-5 mb-8" : "p-8 mb-12"
        )}>
          <div className="text-h3 font-semibold text-purple-400 mb-1">
            Publish Signal
          </div>
          <div className="text-body-sm text-muted-foreground mb-4">
            Share your thoughts with self-evaluation. Published to Nostr relays &amp; IC canister.
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
        <div className={cn(
          "bg-card border border-border rounded-xl",
          mobile ? "p-5 mb-8" : "p-8 mb-12"
        )}>
          <div className="text-h3 font-semibold text-secondary-foreground mb-4">Manual Analysis</div>
          <ManualInput onAnalyze={onAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />
        </div>
      )}

      <div className={cn(
        "bg-card border border-border rounded-xl",
        mobile ? "p-5" : "p-8",
        isAnalyzing && "animate-glow-pulse"
      )}>
        <IncineratorViz active={isAnalyzing} mobile={mobile} />
        <div className={cn("grid gap-2 mt-4", mobile ? "grid-cols-2" : "grid-cols-4")}>
          {STAGES.map(({ id, name, activatable, colorClass }) => {
            const active = activatable && isAnalyzing;
            return (
              <div key={id} className="text-center px-2 py-3 bg-navy-lighter rounded-sm">
                <div className={typography.kpiLabel} style={{ letterSpacing: 1 }}>{id}</div>
                <div className="text-body-sm text-secondary-foreground font-semibold mt-1">{name}</div>
                <div className={cn("text-tiny font-bold mt-1 uppercase", colorClass, active && "animate-pulse")}>
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
