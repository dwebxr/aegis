"use client";
import React from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignalBadge } from "./SignalBadge";
import type { SignalType } from "./SignalBadge";
import { HelpCircleIcon } from "@/components/icons/signal";

interface GlossaryModalProps {
  open: boolean;
  onClose: () => void;
}

const GRADE_ENTRIES: Array<{ grade: string; range: string; color: string; description: string }> = [
  { grade: "A", range: "8.0 - 10", color: "#34d399", description: "Exceptional quality content with high originality and reliable sourcing" },
  { grade: "B", range: "6.0 - 7.9", color: "#22d3ee", description: "Good quality content worth reading" },
  { grade: "C", range: "4.0 - 5.9", color: "#fbbf24", description: "Mixed quality — some useful signal but noticeable issues" },
  { grade: "D", range: "2.0 - 3.9", color: "#fb923c", description: "Low quality — likely derivative or poorly sourced" },
  { grade: "F", range: "0 - 1.9", color: "#f87171", description: "Very low quality — probable AI slop, clickbait, or misinformation" },
];

const SIGNAL_ENTRIES: SignalType[] = [
  "high-signal",
  "rich-context",
  "low-noise",
  "high-slop",
  "original",
  "insightful",
  "credible",
  "low-credibility",
  "derivative",
];

const METRIC_ENTRIES: Array<{ label: string; description: string }> = [
  { label: "Accuracy", description: "Percentage of evaluated content marked as quality over the period" },
  { label: "False Positive", description: "Quality items later flagged by users as slop — lower is better" },
  { label: "User Reviews", description: "Total validated + flagged items — your direct feedback to the filter" },
  { label: "V-Signal", description: "Value signal — measures originality and unique insight (0-10)" },
  { label: "C-Context", description: "Contextual credibility — source reliability and factual grounding (0-10)" },
  { label: "L-Slop", description: "Low-quality probability — detects AI filler, clickbait, and noise (0-10, lower is better)" },
  { label: "Composite", description: "Overall quality score combining V-Signal, C-Context, and L-Slop (0-10)" },
  { label: "WoT", description: "Web of Trust — your Nostr social graph used to weight content from trusted contacts" },
  { label: "D2A", description: "Device-to-Agent — encrypted protocol for AI agents to exchange content peer-to-peer" },
];

const KEYBOARD_ENTRIES: Array<{ key: string; action: string }> = [
  { key: "J / K", action: "Navigate cards" },
  { key: "Enter", action: "Expand / collapse card" },
  { key: "V", action: "Validate current card" },
  { key: "F", action: "Flag current card" },
  { key: "O", action: "Open source in new tab" },
  { key: "\u2318 K", action: "Command palette" },
];

export const GlossaryModal: React.FC<GlossaryModalProps> = ({ open, onClose }) => (
  <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
    <DialogContent className="max-w-[520px] max-h-[80vh] overflow-y-auto bg-card border-emphasis">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-foreground">
          <HelpCircleIcon s={20} /> Glossary & Shortcuts
        </DialogTitle>
      </DialogHeader>

      {/* Grades */}
      <section className="mb-5">
        <h3 className="text-body-sm font-bold text-tertiary uppercase tracking-wider mb-2">Quality Grades</h3>
        <div className="flex flex-col gap-1.5">
          {GRADE_ENTRIES.map(g => (
            <div key={g.grade} className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-7 h-6 rounded-sm text-body-sm font-extrabold font-mono"
                style={{ background: `${g.color}15`, color: g.color, border: `1px solid ${g.color}30` }}
              >
                {g.grade}
              </span>
              <span className="text-caption text-muted-foreground font-mono w-14 shrink-0">{g.range}</span>
              <span className="text-body-sm text-tertiary">{g.description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Signal badges */}
      <section className="mb-5">
        <h3 className="text-body-sm font-bold text-tertiary uppercase tracking-wider mb-2">Signal Badges</h3>
        <div className="flex flex-col gap-1.5">
          {SIGNAL_ENTRIES.map(type => (
            <div key={type} className="flex items-center gap-2">
              <SignalBadge type={type} showLabel />
            </div>
          ))}
        </div>
      </section>

      {/* Metrics */}
      <section className="mb-5">
        <h3 className="text-body-sm font-bold text-tertiary uppercase tracking-wider mb-2">Metrics</h3>
        <div className="flex flex-col gap-1.5">
          {METRIC_ENTRIES.map(m => (
            <div key={m.label} className="flex items-start gap-2">
              <span className="text-body-sm font-bold text-secondary-foreground w-24 shrink-0">{m.label}</span>
              <span className="text-body-sm text-muted-foreground">{m.description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Keyboard shortcuts */}
      <section>
        <h3 className="text-body-sm font-bold text-tertiary uppercase tracking-wider mb-2">Keyboard Shortcuts</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {KEYBOARD_ENTRIES.map(k => (
            <div key={k.key} className="flex items-center gap-2">
              <kbd className={cn(
                "inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 rounded-sm",
                "bg-navy-lighter border border-border text-caption font-mono font-bold text-secondary-foreground"
              )}>
                {k.key}
              </kbd>
              <span className="text-body-sm text-muted-foreground">{k.action}</span>
            </div>
          ))}
        </div>
      </section>

    </DialogContent>
  </Dialog>
);

/** Compact glossary trigger button */
export const GlossaryButton: React.FC<{ onClick: () => void; className?: string }> = ({ onClick, className }) => (
  <button
    onClick={onClick}
    aria-label="Open glossary and keyboard shortcuts"
    className={cn(
      "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1",
      "bg-transparent border border-subtle text-disabled hover:text-tertiary hover:border-border",
      "text-caption font-semibold cursor-pointer font-[inherit] transition-all duration-150",
      className,
    )}
  >
    <HelpCircleIcon s={13} />
    <span>?</span>
  </button>
);
