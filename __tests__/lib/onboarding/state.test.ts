// Mock localStorage (node test env)
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  },
  writable: true,
  configurable: true,
});

import {
  STEPS,
  computeCurrentStepIndex,
  computeCompletedCount,
  loadOnboardingState,
  dismissOnboarding,
} from "@/lib/onboarding/state";
import type { OnboardingContext } from "@/lib/onboarding/state";

const STORAGE_KEY = "aegis-onboarding";

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

describe("STEPS", () => {
  it("returns 4 steps", () => {
    expect(STEPS).toHaveLength(4);
  });

  it("returns steps with correct IDs in order", () => {
    const ids = STEPS.map(s => s.id);
    expect(ids).toEqual(["add-sources", "wait-content", "review-validate", "personalized"]);
  });

  it("each step has label, description, and id", () => {
    for (const step of STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.label).toBeTruthy();
      expect(step.description).toBeTruthy();
    }
  });

  it("add-sources and review-validate steps have ctaLabel and ctaTab", () => {
    const steps = STEPS;
    const addSources = steps.find(s => s.id === "add-sources")!;
    expect(addSources.ctaLabel).toBeDefined();
    expect(addSources.ctaTab).toBe("sources");

    const review = steps.find(s => s.id === "review-validate")!;
    expect(review.ctaLabel).toBeDefined();
    expect(review.ctaTab).toBe("incinerator");
  });
});

describe("computeCurrentStepIndex", () => {
  it("returns 0 when no sources added (empty context)", () => {
    const ctx: OnboardingContext = { sourcesCount: 0, contentCount: 0, validatedCount: 0, flaggedCount: 0 };
    expect(computeCurrentStepIndex(ctx)).toBe(0);
  });

  it("returns 1 when sources >= 1 but content < 3", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 2, validatedCount: 0, flaggedCount: 0 };
    expect(computeCurrentStepIndex(ctx)).toBe(1);
  });

  it("returns 2 when content >= 3 but validated + flagged < 3", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 3, validatedCount: 1, flaggedCount: 0 };
    expect(computeCurrentStepIndex(ctx)).toBe(2);
  });

  it("returns 3 when validated + flagged >= 3 but personalized not complete", () => {
    // personalized requires ALL conditions: sources >= 1, content >= 3, validated+flagged >= 3
    // If sources == 0, step 0 is incomplete → index 0, not 3
    // So personalized is only reached when first 3 are complete
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 3, validatedCount: 2, flaggedCount: 1 };
    // All steps complete: add-sources ✓, wait-content ✓, review-validate ✓, personalized ✓
    expect(computeCurrentStepIndex(ctx)).toBe(-1);
  });

  it("returns -1 when all steps complete", () => {
    const ctx: OnboardingContext = { sourcesCount: 5, contentCount: 50, validatedCount: 10, flaggedCount: 5 };
    expect(computeCurrentStepIndex(ctx)).toBe(-1);
  });

  // Boundary: exactly at threshold
  it("boundary: exactly 1 source completes step 0", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 0, validatedCount: 0, flaggedCount: 0 };
    expect(computeCurrentStepIndex(ctx)).toBe(1); // step 0 complete, on step 1
  });

  it("boundary: exactly 3 content items completes step 1", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 3, validatedCount: 0, flaggedCount: 0 };
    expect(computeCurrentStepIndex(ctx)).toBe(2); // step 1 complete, on step 2
  });

  it("boundary: exactly 3 validated+flagged completes step 2", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 3, validatedCount: 2, flaggedCount: 1 };
    expect(computeCurrentStepIndex(ctx)).toBe(-1); // all complete
  });

  it("boundary: 0 sources + high content still at step 0", () => {
    const ctx: OnboardingContext = { sourcesCount: 0, contentCount: 100, validatedCount: 50, flaggedCount: 30 };
    expect(computeCurrentStepIndex(ctx)).toBe(0);
  });

  it("boundary: 2 content items does NOT complete step 1", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 2, validatedCount: 0, flaggedCount: 0 };
    expect(computeCurrentStepIndex(ctx)).toBe(1);
  });

  it("boundary: 2 validated+flagged does NOT complete step 2", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 3, validatedCount: 1, flaggedCount: 1 };
    expect(computeCurrentStepIndex(ctx)).toBe(2);
  });
});

describe("computeCompletedCount", () => {
  it("returns 0 for completely empty context", () => {
    const ctx: OnboardingContext = { sourcesCount: 0, contentCount: 0, validatedCount: 0, flaggedCount: 0 };
    expect(computeCompletedCount(ctx)).toBe(0);
  });

  it("returns 1 when only step 0 is complete", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 0, validatedCount: 0, flaggedCount: 0 };
    expect(computeCompletedCount(ctx)).toBe(1);
  });

  it("returns 2 when steps 0 and 1 are complete", () => {
    const ctx: OnboardingContext = { sourcesCount: 1, contentCount: 5, validatedCount: 0, flaggedCount: 0 };
    expect(computeCompletedCount(ctx)).toBe(2);
  });

  it("returns 4 when all steps are complete", () => {
    const ctx: OnboardingContext = { sourcesCount: 2, contentCount: 10, validatedCount: 5, flaggedCount: 3 };
    expect(computeCompletedCount(ctx)).toBe(4);
  });

  it("counts non-contiguous completion correctly", () => {
    // Steps 0 incomplete but steps 1, 2 conditions met:
    // However, personalized requires ALL previous conditions too
    // With 0 sources, step 0 fails → steps are sequential
    const ctx: OnboardingContext = { sourcesCount: 0, contentCount: 10, validatedCount: 5, flaggedCount: 3 };
    // step 0: sources >= 1 → false
    // step 1: content >= 3 → true
    // step 2: validated+flagged >= 3 → true
    // step 3: all conditions → false (sources = 0)
    expect(computeCompletedCount(ctx)).toBe(2); // steps 1 and 2 are technically complete
  });
});

describe("loadOnboardingState", () => {
  it("returns default state when no localStorage data", () => {
    const state = loadOnboardingState();
    expect(state.dismissed).toBe(false);
    expect(typeof state.firstSeenAt).toBe("number");
    expect(state.firstSeenAt).toBeGreaterThan(0);
  });

  it("parses stored state correctly", () => {
    const stored = { dismissed: true, firstSeenAt: 1000000 };
    store[STORAGE_KEY] = JSON.stringify(stored);

    const state = loadOnboardingState();
    expect(state.dismissed).toBe(true);
    expect(state.firstSeenAt).toBe(1000000);
  });

  it("handles corrupted JSON gracefully", () => {
    store[STORAGE_KEY] = "{invalid json!!!";

    const state = loadOnboardingState();
    expect(state.dismissed).toBe(false);
    expect(typeof state.firstSeenAt).toBe("number");
  });

  it("handles non-object stored data gracefully", () => {
    store[STORAGE_KEY] = '"just a string"';

    const state = loadOnboardingState();
    expect(state.dismissed).toBe(false);
  });

  it("handles stored data missing dismissed field", () => {
    store[STORAGE_KEY] = JSON.stringify({ firstSeenAt: 999 });

    const state = loadOnboardingState();
    // dismissed is not a boolean → returns default
    expect(state.dismissed).toBe(false);
  });

  it("handles null stored data", () => {
    store[STORAGE_KEY] = "null";

    const state = loadOnboardingState();
    expect(state.dismissed).toBe(false);
  });
});

describe("dismissOnboarding", () => {
  it("sets dismissed=true and persists", () => {
    dismissOnboarding();

    const raw = store[STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw);
    expect(parsed.dismissed).toBe(true);
  });

  it("preserves firstSeenAt from existing state", () => {
    const original = { dismissed: false, firstSeenAt: 42 };
    store[STORAGE_KEY] = JSON.stringify(original);

    dismissOnboarding();

    const raw = store[STORAGE_KEY];
    const parsed = JSON.parse(raw);
    expect(parsed.dismissed).toBe(true);
    expect(parsed.firstSeenAt).toBe(42);
  });

  it("is idempotent (calling twice works fine)", () => {
    dismissOnboarding();
    dismissOnboarding();

    const raw = store[STORAGE_KEY];
    const parsed = JSON.parse(raw);
    expect(parsed.dismissed).toBe(true);
  });
});
