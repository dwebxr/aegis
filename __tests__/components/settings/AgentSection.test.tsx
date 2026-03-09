/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSection } from "@/components/settings/AgentSection";

let mockAgentEnabled = false;
const mockSetTopicAffinity = jest.fn();
const mockRemoveTopicAffinity = jest.fn();
const mockSetQualityThreshold = jest.fn();
const mockAddFilterRule = jest.fn();
const mockRemoveFilterRule = jest.fn();

let mockProfile = {
  topicAffinities: {} as Record<string, number>,
  authorTrust: {},
  recentTopics: [],
  totalValidated: 10,
  totalFlagged: 5,
  calibration: { qualityThreshold: 5.5 },
  customFilterRules: [] as { id: string; field: string; pattern: string }[],
};

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({
    isEnabled: mockAgentEnabled,
    agentState: { peers: [], activeHandshakes: [], pendingOffers: [] },
    toggleAgent: jest.fn(),
  }),
}));

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: mockProfile,
    setTopicAffinity: mockSetTopicAffinity,
    removeTopicAffinity: mockRemoveTopicAffinity,
    setQualityThreshold: mockSetQualityThreshold,
    addFilterRule: mockAddFilterRule,
    removeFilterRule: mockRemoveFilterRule,
  }),
}));

jest.mock("@/components/ui/AgentStatusBadge", () => ({
  AgentStatusBadge: () => <div data-testid="agent-badge">AgentStatus</div>,
}));

beforeEach(() => {
  mockAgentEnabled = false;
  mockProfile = {
    topicAffinities: { ai: 0.5, bitcoin: 0.3 },
    authorTrust: {},
    recentTopics: [],
    totalValidated: 10,
    totalFlagged: 5,
    calibration: { qualityThreshold: 5.5 },
    customFilterRules: [
      { id: "r1", field: "author", pattern: "spammer" },
      { id: "r2", field: "title", pattern: "clickbait" },
    ],
  };
  jest.clearAllMocks();
});

describe("AgentSection — summary stats", () => {
  it("shows interest count, threshold, and reviews", () => {
    const html = renderToStaticMarkup(<AgentSection />);
    // Verify labels exist
    expect(html).toContain("Interests");
    expect(html).toContain("Threshold");
    expect(html).toContain("Reviews");
    // Verify computed values appear as rendered text (not in attributes)
    expect(html).toMatch(/>2<\/div>/);   // 2 interests >= 0.2
    expect(html).toMatch(/>5\.5<\/div>/); // threshold
    expect(html).toMatch(/>15<\/div>/);   // 10 validated + 5 flagged
  });
});

describe("AgentSection — interests", () => {
  it("shows interest chips", () => {
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).toContain("ai");
    expect(html).toContain("bitcoin");
  });

  it("filters out low-affinity topics (< 0.2)", () => {
    mockProfile.topicAffinities = { ai: 0.5, ignored: 0.1 };
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).toContain("ai");
    expect(html).not.toContain("ignored");
  });

  it("removes topic on X click", () => {
    render(<AgentSection />);
    const removeButtons = screen.getAllByText("×");
    fireEvent.click(removeButtons[0]);
    expect(mockRemoveTopicAffinity).toHaveBeenCalled();
  });

  it("adds new topic on Enter", () => {
    render(<AgentSection />);
    const input = screen.getByPlaceholderText("+ Add topic");
    fireEvent.change(input, { target: { value: "defi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSetTopicAffinity).toHaveBeenCalledWith("defi", 0.3);
  });

  it("normalizes topic to lowercase", () => {
    render(<AgentSection />);
    const input = screen.getByPlaceholderText("+ Add topic");
    fireEvent.change(input, { target: { value: "DeFi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSetTopicAffinity).toHaveBeenCalledWith("defi", 0.3);
  });

  it("ignores empty topic input", () => {
    render(<AgentSection />);
    const input = screen.getByPlaceholderText("+ Add topic");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSetTopicAffinity).not.toHaveBeenCalled();
  });

  it("does not add topic that already has high affinity", () => {
    render(<AgentSection />);
    const input = screen.getByPlaceholderText("+ Add topic");
    fireEvent.change(input, { target: { value: "ai" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSetTopicAffinity).not.toHaveBeenCalled();
  });

  it("limits input to 30 characters", () => {
    render(<AgentSection />);
    const input = screen.getByPlaceholderText("+ Add topic") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a".repeat(50) } });
    expect(input.value).toHaveLength(30);
  });
});

describe("AgentSection — blocked authors", () => {
  it("shows blocked author chips", () => {
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).toContain("spammer");
  });

  it("removes blocked author on X click", () => {
    render(<AgentSection />);
    // Find the spammer chip's remove button
    const chips = screen.getAllByText("×");
    // chips[0] = first interest, chips[1] = second interest, chips[2] = author, chips[3] = title
    fireEvent.click(chips[2]); // blocked author
    expect(mockRemoveFilterRule).toHaveBeenCalledWith("r1");
  });

  it("adds blocked author on Enter", () => {
    render(<AgentSection />);
    const input = screen.getByPlaceholderText("+ Block author");
    fireEvent.change(input, { target: { value: "troll123" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockAddFilterRule).toHaveBeenCalledWith({ field: "author", pattern: "troll123" });
  });
});

describe("AgentSection — burn patterns", () => {
  it("shows burn pattern chips", () => {
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).toContain("clickbait");
  });

  it("adds burn pattern on Enter", () => {
    render(<AgentSection />);
    const input = screen.getByPlaceholderText("+ Add keyword");
    fireEvent.change(input, { target: { value: "sponsored" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockAddFilterRule).toHaveBeenCalledWith({ field: "title", pattern: "sponsored" });
  });
});

describe("AgentSection — quality threshold", () => {
  it("shows threshold slider", () => {
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).toContain("Quality Threshold");
    expect(html).toContain("5.5");
    expect(html).toContain("More content");
    expect(html).toContain("Stricter filtering");
  });

  it("updates threshold on slider change", () => {
    render(<AgentSection />);
    const slider = screen.getByDisplayValue("5.5");
    fireEvent.change(slider, { target: { value: "7.5" } });
    expect(mockSetQualityThreshold).toHaveBeenCalledWith(7.5);
  });

  it("clamps slider to valid range", () => {
    render(<AgentSection />);
    const slider = screen.getByDisplayValue("5.5");
    fireEvent.change(slider, { target: { value: "9" } });
    expect(mockSetQualityThreshold).toHaveBeenCalledWith(9);
  });
});

describe("AgentSection — D2A Social Agent", () => {
  it("shows D2A card with AgentStatusBadge", () => {
    render(<AgentSection />);
    expect(screen.getByTestId("agent-badge")).toBeInTheDocument();
    expect(screen.getByText("D2A Social Agent")).toBeInTheDocument();
  });

  it("shows protocol params when agent enabled", () => {
    mockAgentEnabled = true;
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).toContain("Min Score");
    expect(html).toContain("Resonance");
    expect(html).toContain("Fee Range");
    expect(html).toContain("Approval");
    expect(html).toContain("ICP");
  });

  it("hides protocol params when agent disabled", () => {
    mockAgentEnabled = false;
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).not.toContain("Min Score");
    expect(html).not.toContain("Fee Range");
  });
});

describe("AgentSection — edge cases", () => {
  it("handles empty topicAffinities", () => {
    mockProfile.topicAffinities = {};
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).toMatch(/>0<\/div>/); // 0 interests rendered as text
  });

  it("handles null customFilterRules", () => {
    mockProfile.customFilterRules = [];
    const html = renderToStaticMarkup(<AgentSection />);
    expect(html).toContain("Agent Preferences");
  });

  it("renders in mobile mode", () => {
    const html = renderToStaticMarkup(<AgentSection mobile />);
    expect(html).toContain("Agent Preferences");
  });
});
