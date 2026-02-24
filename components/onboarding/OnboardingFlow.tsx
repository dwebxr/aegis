"use client";
import React, { useState, useEffect } from "react";
import { colors, space, type as t, radii, transitions } from "@/styles/theme";
import {
  getSteps,
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

  const steps = getSteps();
  const currentIdx = computeCurrentStepIndex(context);
  const completedCount = computeCompletedCount(context);

  // All steps complete or dismissed
  if (dismissed || currentIdx === -1) return null;

  const current = steps[currentIdx];

  const handleDismiss = () => {
    dismissOnboarding();
    setDismissed(true);
  };

  const ctaAction = () => {
    if (!onTabChange) return;
    switch (current.id) {
      case "add-sources":
        onTabChange("sources");
        break;
      case "review-validate":
        onTabChange("incinerator");
        break;
    }
  };

  const ctaLabel = (() => {
    switch (current.id) {
      case "add-sources": return "Add Sources \u2192";
      case "wait-content": return null; // No CTA, just waiting
      case "review-validate": return "Go to Incinerator \u2192";
      case "personalized": return "View Dashboard \u2192";
    }
  })();

  return (
    <div style={{
      background: colors.bg.surface,
      border: `1px solid ${colors.border.default}`,
      borderRadius: radii.lg,
      padding: mobile ? space[4] : space[6],
      marginBottom: space[4],
    }}>
      {/* Progress dots */}
      <div style={{
        display: "flex", alignItems: "center", gap: space[2],
        marginBottom: space[4],
      }}>
        {steps.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: space[1] }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: i < completedCount
                ? colors.green[400]
                : i === currentIdx
                  ? colors.blue[400]
                  : colors.border.emphasis,
              transition: transitions.fast,
              animation: i === currentIdx ? "pulse 2s infinite" : undefined,
            }} />
            {i < steps.length - 1 && (
              <div style={{
                width: mobile ? 12 : 24, height: 1,
                background: i < completedCount ? colors.green[400] : colors.border.emphasis,
              }} />
            )}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{
          fontSize: t.caption.size, color: colors.text.disabled,
        }}>
          {completedCount}/{steps.length}
        </span>
      </div>

      {/* Current step */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
        <span style={{ fontSize: 28 }}>{STEP_ICONS[currentIdx]}</span>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: t.h3.size, fontWeight: t.h3.weight,
            color: colors.text.secondary, marginBottom: space[1],
          }}>
            {current.label}
          </div>
          <div style={{
            fontSize: t.bodySm.size, color: colors.text.muted,
            lineHeight: 1.5,
          }}>
            {current.description}
          </div>

          {current.id === "wait-content" && (
            <div style={{
              fontSize: t.caption.size, color: colors.text.disabled,
              marginTop: space[2],
            }}>
              {context.contentCount > 0
                ? `${context.contentCount} item${context.contentCount !== 1 ? "s" : ""} received so far...`
                : "This usually takes a minute after adding sources."}
            </div>
          )}

          <div style={{ display: "flex", gap: space[2], marginTop: space[3], flexWrap: "wrap" }}>
            {ctaLabel && onTabChange && (
              <button
                onClick={ctaAction}
                style={{
                  padding: `${space[2]}px ${space[4]}px`,
                  background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))",
                  border: `1px solid ${colors.blue[400]}`,
                  borderRadius: radii.md,
                  color: colors.blue[400],
                  fontSize: t.bodySm.size,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: transitions.fast,
                }}
              >
                {ctaLabel}
              </button>
            )}
            <button
              onClick={handleDismiss}
              style={{
                padding: `${space[2]}px ${space[3]}px`,
                background: "none",
                border: "none",
                color: colors.text.disabled,
                fontSize: t.caption.size,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
