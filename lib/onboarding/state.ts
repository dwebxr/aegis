/**
 * Onboarding state management with localStorage persistence.
 * Tracks which onboarding steps the user has seen/completed.
 */

const STORAGE_KEY = "aegis-onboarding";

export interface OnboardingState {
  dismissed: boolean;
  firstSeenAt: number;
}

export interface OnboardingContext {
  sourcesCount: number;
  contentCount: number;
  validatedCount: number;
  flaggedCount: number;
}

export interface OnboardingStep {
  id: "add-sources" | "wait-content" | "review-validate" | "personalized";
  label: string;
  description: string;
}

const STEPS: OnboardingStep[] = [
  {
    id: "add-sources",
    label: "Add Sources",
    description: "Add RSS feeds, Nostr relays, or URLs to start receiving content.",
  },
  {
    id: "wait-content",
    label: "Receive Content",
    description: "Your agent is fetching and scoring content from your sources.",
  },
  {
    id: "review-validate",
    label: "Review & Validate",
    description: "Validate quality items or flag slop to teach your agent your preferences.",
  },
  {
    id: "personalized",
    label: "Personalized",
    description: "Your agent now understands your preferences. Briefings and Discoveries are personalized!",
  },
];

export function getSteps(): OnboardingStep[] {
  return STEPS;
}

function isStepComplete(step: OnboardingStep, ctx: OnboardingContext): boolean {
  switch (step.id) {
    case "add-sources":
      return ctx.sourcesCount >= 1;
    case "wait-content":
      return ctx.contentCount >= 3;
    case "review-validate":
      return ctx.validatedCount + ctx.flaggedCount >= 3;
    case "personalized":
      return ctx.validatedCount + ctx.flaggedCount >= 3 && ctx.sourcesCount >= 1 && ctx.contentCount >= 3;
  }
}

/** Returns the index of the first incomplete step, or -1 if all complete. */
export function computeCurrentStepIndex(ctx: OnboardingContext): number {
  for (let i = 0; i < STEPS.length; i++) {
    if (!isStepComplete(STEPS[i], ctx)) return i;
  }
  return -1;
}

/** Returns how many steps are completed. */
export function computeCompletedCount(ctx: OnboardingContext): number {
  return STEPS.filter(s => isStepComplete(s, ctx)).length;
}

export function loadOnboardingState(): OnboardingState {
  if (typeof globalThis.localStorage === "undefined") {
    return { dismissed: false, firstSeenAt: Date.now() };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissed: false, firstSeenAt: Date.now() };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.dismissed === "boolean") {
      return parsed as OnboardingState;
    }
    return { dismissed: false, firstSeenAt: Date.now() };
  } catch {
    return { dismissed: false, firstSeenAt: Date.now() };
  }
}

export function dismissOnboarding(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const state = loadOnboardingState();
    state.dismissed = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}
