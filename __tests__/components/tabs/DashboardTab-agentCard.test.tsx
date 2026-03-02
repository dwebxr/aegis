/**
 * @jest-environment jsdom
 */
// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardTab } from "@/components/tabs/DashboardTab";

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({ filterMode: "lite", setFilterMode: jest.fn() }),
}));

let mockProfile = {
  topicAffinities: { ai: 0.8, crypto: 0.5, ignored: 0.1 } as Record<string, number>,
  authorTrust: {},
  recentTopics: [],
  totalValidated: 12,
  totalFlagged: 3,
  calibration: { qualityThreshold: 6.0 },
};

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: mockProfile,
    setTopicAffinity: jest.fn(),
    removeTopicAffinity: jest.fn(),
    setQualityThreshold: jest.fn(),
  }),
}));

jest.mock("@/components/ui/D2ANetworkMini", () => ({
  D2ANetworkMini: () => null,
}));

jest.mock("@/contexts/SourceContext", () => ({
  useSources: () => ({ sources: [] }),
}));

jest.mock("@/contexts/DemoContext", () => ({
  useDemo: () => ({ isDemoMode: false }),
}));

beforeEach(() => {
  localStorage.setItem("aegis-home-mode", "dashboard");
  mockProfile = {
    topicAffinities: { ai: 0.8, crypto: 0.5, ignored: 0.1 },
    authorTrust: {},
    recentTopics: [],
    totalValidated: 12,
    totalFlagged: 3,
    calibration: { qualityThreshold: 6.0 },
  };
});

afterEach(() => {
  localStorage.removeItem("aegis-home-mode");
});

describe("DashboardTab — Agent Settings summary card", () => {
  it("shows interest count (only >= 0.2 threshold)", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // ai (0.8) + crypto (0.5) = 2 interests; ignored (0.1) filtered out
    expect(html).toContain("2 interests");
  });

  it("shows quality threshold value", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("threshold 6.0");
  });

  it("shows total reviews (validated + flagged)", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // 12 + 3 = 15
    expect(html).toContain("15 reviews");
  });

  it("shows Edit button", () => {
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("Edit");
  });

  it("Edit button calls onTabChange with 'settings:agent'", () => {
    const mockTabChange = jest.fn();
    render(
      <DashboardTab
        content={[]}
        onValidate={jest.fn()}
        onFlag={jest.fn()}
        onTabChange={mockTabChange}
      />
    );
    // Find the "Edit" button in the Agent Settings card
    const editButtons = screen.getAllByText("Edit");
    // Click the first Edit button (agent settings card)
    fireEvent.click(editButtons[0]);
    expect(mockTabChange).toHaveBeenCalledWith("settings:agent");
  });

  it("updates summary when profile changes", () => {
    mockProfile.topicAffinities = {};
    mockProfile.totalValidated = 0;
    mockProfile.totalFlagged = 0;
    mockProfile.calibration.qualityThreshold = 5.5;
    const html = renderToStaticMarkup(
      <DashboardTab content={[]} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("0 interests");
    expect(html).toContain("threshold 5.5");
    expect(html).toContain("0 reviews");
  });
});
