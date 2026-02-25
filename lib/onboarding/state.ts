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
  ctaLabel?: string;
  ctaTab?: string;
}

export const STEPS: OnboardingStep[] = [
  {
    id: "add-sources",
    label: "Add Sources",
    description: "Add RSS feeds, Nostr relays, or URLs to start receiving content.",
    ctaLabel: "Add Sources \u2192",
    ctaTab: "sources",
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
    ctaLabel: "Go to Incinerator \u2192",
    ctaTab: "incinerator",
  },
  {
    id: "personalized",
    label: "Personalized",
    description: "Your agent now understands your preferences. Briefings and Discoveries are personalized!",
    ctaLabel: "View Dashboard \u2192",
  },
];

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
  } catch (err) {
    console.debug("[onboarding] Failed to parse state, using default:", err);
    return { dismissed: false, firstSeenAt: Date.now() };
  }
}

export function dismissOnboarding(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    const state = loadOnboardingState();
    state.dismissed = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[onboarding] Failed to persist dismiss state:", err);
  }
}
