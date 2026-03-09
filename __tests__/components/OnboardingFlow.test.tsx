/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock onboarding state
const mockLoadOnboardingState = jest.fn().mockReturnValue({ dismissed: false, firstSeenAt: Date.now() });
const mockDismissOnboarding = jest.fn();

jest.mock("@/lib/onboarding/state", () => ({
  ...jest.requireActual("@/lib/onboarding/state"),
  loadOnboardingState: () => mockLoadOnboardingState(),
  dismissOnboarding: () => mockDismissOnboarding(),
}));

import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import type { OnboardingContext } from "@/lib/onboarding/state";

function makeContext(overrides: Partial<OnboardingContext> = {}): OnboardingContext {
  return {
    sourcesCount: 0,
    contentCount: 0,
    validatedCount: 0,
    flaggedCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadOnboardingState.mockReturnValue({ dismissed: false, firstSeenAt: Date.now() });
});

describe("OnboardingFlow", () => {
  it("renders first step when no sources added", () => {
    render(<OnboardingFlow context={makeContext()} />);
    expect(screen.getByText("Add Sources")).toBeInTheDocument();
    expect(screen.getByText(/Add RSS feeds/)).toBeInTheDocument();
  });

  it("renders second step when sources exist but no content", () => {
    render(<OnboardingFlow context={makeContext({ sourcesCount: 2 })} />);
    expect(screen.getByText("Receive Content")).toBeInTheDocument();
  });

  it("shows content count on wait-content step", () => {
    render(<OnboardingFlow context={makeContext({ sourcesCount: 2, contentCount: 1 })} />);
    expect(screen.getByText(/1 item received so far/)).toBeInTheDocument();
  });

  it("shows waiting message when content count is 0 on wait step", () => {
    render(<OnboardingFlow context={makeContext({ sourcesCount: 2, contentCount: 0 })} />);
    expect(screen.getByText(/This usually takes a minute/)).toBeInTheDocument();
  });

  it("renders third step when content exists but not enough validates", () => {
    render(<OnboardingFlow context={makeContext({ sourcesCount: 2, contentCount: 5 })} />);
    expect(screen.getByText("Review & Validate")).toBeInTheDocument();
  });

  it("returns null when all steps complete", () => {
    const { container } = render(
      <OnboardingFlow context={makeContext({ sourcesCount: 2, contentCount: 5, validatedCount: 3 })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when dismissed", () => {
    mockLoadOnboardingState.mockReturnValue({ dismissed: true, firstSeenAt: Date.now() });
    const { container } = render(<OnboardingFlow context={makeContext()} />);
    expect(container.firstChild).toBeNull();
  });

  it("dismiss button persists dismiss state", () => {
    render(<OnboardingFlow context={makeContext()} />);
    const dismissBtn = screen.getByText("Dismiss");
    fireEvent.click(dismissBtn);
    expect(mockDismissOnboarding).toHaveBeenCalledTimes(1);
  });

  it("CTA button calls onTabChange with correct tab", () => {
    const onTabChange = jest.fn();
    render(<OnboardingFlow context={makeContext()} onTabChange={onTabChange} />);
    const ctaBtn = screen.getByText(/Add Sources \u2192/);
    fireEvent.click(ctaBtn);
    expect(onTabChange).toHaveBeenCalledWith("sources");
  });

  it("does not render CTA when onTabChange is not provided", () => {
    render(<OnboardingFlow context={makeContext({ sourcesCount: 2, contentCount: 5 })} />);
    expect(screen.queryByText(/Go to Incinerator/)).toBeNull();
  });

  it("shows progress counter", () => {
    render(<OnboardingFlow context={makeContext({ sourcesCount: 2 })} />);
    expect(screen.getByText("1/4")).toBeInTheDocument();
  });

  it("shows 0/4 when nothing completed", () => {
    render(<OnboardingFlow context={makeContext()} />);
    expect(screen.getByText("0/4")).toBeInTheDocument();
  });

  it("applies mobile styling", () => {
    const { container } = render(<OnboardingFlow context={makeContext()} mobile />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("p-4");
  });

  it("shows plural 'items' for multiple content", () => {
    render(<OnboardingFlow context={makeContext({ sourcesCount: 2, contentCount: 2 })} />);
    expect(screen.getByText(/2 items received/)).toBeInTheDocument();
  });

  it("shows singular 'item' for 1 content", () => {
    render(<OnboardingFlow context={makeContext({ sourcesCount: 2, contentCount: 1 })} />);
    expect(screen.getByText(/1 item received/)).toBeInTheDocument();
  });
});
