"use client";
import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  STEPS,
  computeCurrentStepIndex,
  computeCompletedCount,
  loadOnboardingState,
  dismissOnboarding,
  type OnboardingContext,
} from "@/lib/onboarding/state";

interface OnboardingFlowProps {
  context: OnboardingContext;
  mobile?: boolean;
  onTabChange?: (tab: string) => void;
}

const STEP_ICONS = ["\u{1F4E1}", "\u{23F3}", "\u{2705}", "\u{1F389}"];

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ context, mobile, onTabChange }) => {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const state = loadOnboardingState();
    setDismissed(state.dismissed);
  }, []);

  const steps = STEPS;
  const currentIdx = computeCurrentStepIndex(context);
  const completedCount = computeCompletedCount(context);

  if (dismissed || currentIdx === -1) return null;

  const current = steps[currentIdx];

  const handleDismiss = () => {
    dismissOnboarding();
    setDismissed(true);
  };

  const ctaLabel = current.ctaLabel;
  const ctaAction = () => { if (current.ctaTab && onTabChange) onTabChange(current.ctaTab); };

  return (
    <div className={cn("bg-card border border-border rounded-lg mb-4", mobile ? "p-4" : "p-6")}>
      {/* Progress dots */}
      <div className="flex items-center gap-2 mb-4">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1">
            <div
              className={cn(
                "size-2 rounded-full transition-fast",
                i < completedCount ? "bg-green-400"
                  : i === currentIdx ? "bg-blue-400 animate-pulse"
                  : "bg-[var(--color-border-emphasis)]"
              )}
            />
            {i < steps.length - 1 && (
              <div
                className={cn("h-px", i < completedCount ? "bg-green-400" : "bg-[var(--color-border-emphasis)]")}
                style={{ width: mobile ? 12 : 24 }}
              />
            )}
          </div>
        ))}
        <div className="flex-1" />
        <span className="text-caption text-[var(--color-text-disabled)]">
          {completedCount}/{steps.length}
        </span>
      </div>

      {/* Current step */}
      <div className="flex items-start gap-3">
        <span className="text-[28px]">{STEP_ICONS[currentIdx] ?? "\u2753"}</span>
        <div className="flex-1">
          <div className="text-h3 font-semibold text-secondary-foreground mb-1">
            {current.label}
          </div>
          <div className="text-body-sm text-muted-foreground leading-normal">
            {current.description}
          </div>

          {current.id === "wait-content" && (
            <div className="text-caption text-[var(--color-text-disabled)] mt-2">
              {context.contentCount > 0
                ? `${context.contentCount} item${context.contentCount !== 1 ? "s" : ""} received so far...`
                : "This usually takes a minute after adding sources."}
            </div>
          )}

          <div className="flex gap-2 mt-3 flex-wrap">
            {ctaLabel && onTabChange && (
              <button
                onClick={ctaAction}
                className="px-4 py-2 bg-gradient-to-br from-blue-500/15 to-purple-500/15 border border-blue-400 rounded-md text-blue-400 text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast"
              >
                {ctaLabel}
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="px-3 py-2 bg-transparent border-none text-[var(--color-text-disabled)] text-caption cursor-pointer font-[inherit]"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
