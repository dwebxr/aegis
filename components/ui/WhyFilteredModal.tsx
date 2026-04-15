"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { ScoreBar } from "./ScoreBar";
import { colors } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import type { BurnedByRule } from "@/lib/filtering/types";
import { ENGINE_LABELS, decodeEngineFromReason } from "@/lib/scoring/types";

export type BurnReasonKind =
  | { kind: "verdict-slop" }
  | { kind: "custom-rule"; rule: BurnedByRule }
  | { kind: "below-threshold"; composite: number; threshold: number };

interface WhyFilteredModalProps {
  open: boolean;
  onClose: () => void;
  item: ContentItem;
  reason: BurnReasonKind;
  qualityThreshold: number;
}

function VerdictBanner({ reason }: { reason: BurnReasonKind }): React.ReactElement {
  switch (reason.kind) {
    case "verdict-slop":
      return (
        <div className="rounded-md bg-orange-500/[0.08] border border-orange-500/20 px-3 py-2 text-orange-300">
          <div className="font-semibold text-body-sm">Filtered as slop</div>
          <div className="text-caption text-orange-300/80">The scoring engine classified this item below the quality bar.</div>
        </div>
      );
    case "custom-rule":
      return (
        <div className="rounded-md bg-amber-500/[0.08] border border-amber-500/20 px-3 py-2 text-amber-300">
          <div className="font-semibold text-body-sm">Burned by custom rule</div>
          <div className="text-caption text-amber-300/80">
            Your rule on <span className="font-mono">{reason.rule.field}</span> matched <span className="font-mono">&quot;{reason.rule.pattern}&quot;</span>.
          </div>
        </div>
      );
    case "below-threshold":
      return (
        <div className="rounded-md bg-red-500/[0.08] border border-red-500/20 px-3 py-2 text-red-300">
          <div className="font-semibold text-body-sm">Below quality threshold</div>
          <div className="text-caption text-red-300/80">
            Composite <span className="font-mono">{reason.composite.toFixed(1)}</span> &lt; threshold <span className="font-mono">{reason.threshold.toFixed(1)}</span>
          </div>
        </div>
      );
  }
}

export const WhyFilteredModal: React.FC<WhyFilteredModalProps> = ({
  open,
  onClose,
  item,
  reason,
  qualityThreshold,
}) => {
  const decoded = decodeEngineFromReason(item.reason);
  const engine = item.scoringEngine ?? decoded.engine;
  const engineLabel = engine ? ENGINE_LABELS[engine] : "Unknown engine";
  const cleanReason = decoded.cleanReason || "(no reason recorded)";
  const { vSignal, cContext, lSlop } = item;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-testid="why-filtered-modal"
        className="max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>Why was this filtered?</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <VerdictBanner reason={reason} />

          <div className="rounded-md border border-border bg-card px-3 py-2">
            <div className="text-caption text-muted-foreground mb-1">
              <span className="font-semibold text-tertiary">{item.author}</span>
              <span> · {item.source}</span>
            </div>
            <div className="text-body-sm line-clamp-3">{item.text}</div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-body-sm">
            <span className="text-muted-foreground">Scoring engine</span>
            <span className="font-mono font-bold text-tertiary">{engineLabel}</span>
          </div>

          <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-body-sm">
            <span className="text-muted-foreground">Composite vs threshold</span>
            <span className="font-mono">
              <span className={item.scores.composite < qualityThreshold ? "text-red-400 font-bold" : "text-emerald-400 font-bold"}>
                {item.scores.composite.toFixed(1)}
              </span>
              <span className="text-disabled mx-1">/</span>
              <span className="text-tertiary">{qualityThreshold.toFixed(1)}</span>
            </span>
          </div>

          {vSignal !== undefined && cContext !== undefined && lSlop !== undefined && (
            <div>
              <div className="text-caption text-muted-foreground mb-1.5">V/C/L breakdown</div>
              <ScoreBar label="V — Signal" score={vSignal} color={colors.purple[400]} />
              <ScoreBar label="C — Context" score={cContext} color={colors.sky[400]} />
              <ScoreBar label="L — Slop" score={lSlop} color={colors.red[400]} />
            </div>
          )}

          <div>
            <div className="text-caption text-muted-foreground mb-1.5">O/I/C breakdown (legacy)</div>
            <ScoreBar label="Originality" score={item.scores.originality} color={colors.purple[500]} />
            <ScoreBar label="Insight" score={item.scores.insight} color={colors.sky[400]} />
            <ScoreBar label="Credibility" score={item.scores.credibility} color={colors.green[500]} />
          </div>

          <div>
            <div className="text-caption text-muted-foreground mb-1">AI explanation</div>
            <div className="rounded-md border border-border bg-card px-3 py-2 text-body-sm text-tertiary">
              {cleanReason}
            </div>
          </div>

          {/* Reasons stay local — never published to peers (security guarantee). */}
          <p className="text-caption text-disabled">
            This explanation was produced by {engineLabel}. Reasons are stored locally in your browser and never sent to other Aegis users.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
