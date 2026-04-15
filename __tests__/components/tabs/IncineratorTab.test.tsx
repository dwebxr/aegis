/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";

jest.mock("@/components/ui/IncineratorViz", () => ({
  IncineratorViz: ({ active, mobile }: { active: boolean; mobile?: boolean }) => (
    <div data-testid="incinerator-viz" data-active={active} data-mobile={mobile} />
  ),
}));

jest.mock("@/components/sources/ManualInput", () => ({
  ManualInput: ({ isAnalyzing }: { isAnalyzing: boolean }) => (
    <div data-testid="manual-input" data-analyzing={isAnalyzing} />
  ),
}));

jest.mock("@/components/ui/SignalComposer", () => ({
  SignalComposer: ({ nostrPubkey }: { nostrPubkey: string | null }) => (
    <div data-testid="signal-composer" data-pubkey={nostrPubkey} />
  ),
}));

import { IncineratorTab } from "@/components/tabs/IncineratorTab";
import type { AnalyzeResponse } from "@/lib/types/api";

const mockOnAnalyze = jest.fn().mockResolvedValue({
  originality: 5, insight: 5, credibility: 5, composite: 5,
  verdict: "quality", reason: "ok",
} as AnalyzeResponse);

describe("IncineratorTab", () => {
  it("renders heading and description", () => {
    render(<IncineratorTab isAnalyzing={false} onAnalyze={mockOnAnalyze} />);
    expect(screen.getByTestId("aegis-incinerator-heading").textContent).toBe("Slop Incinerator + Signal");
    expect(screen.getByText(/Evaluate content quality/)).toBeInTheDocument();
  });

  it("shows ManualInput when onPublishSignal is not provided", () => {
    render(<IncineratorTab isAnalyzing={false} onAnalyze={mockOnAnalyze} />);
    expect(screen.getByTestId("manual-input")).toBeInTheDocument();
    expect(screen.queryByTestId("signal-composer")).toBeNull();
  });

  it("shows SignalComposer when onPublishSignal is provided", () => {
    const onPublish = jest.fn();
    render(
      <IncineratorTab
        isAnalyzing={false}
        onAnalyze={mockOnAnalyze}
        onPublishSignal={onPublish}
        nostrPubkey="npub123"
      />,
    );
    expect(screen.getByTestId("signal-composer")).toBeInTheDocument();
    expect(screen.queryByTestId("manual-input")).toBeNull();
  });

  it("renders all 3 implemented pipeline stages", () => {
    render(<IncineratorTab isAnalyzing={false} onAnalyze={mockOnAnalyze} />);
    expect(screen.getByText("Heuristic Filter")).toBeInTheDocument();
    expect(screen.getByText("Structural")).toBeInTheDocument();
    expect(screen.getByText("LLM Score")).toBeInTheDocument();
    // S4 Cross-Valid was a perpetually-IDLE placeholder; removed.
    expect(screen.queryByText("Cross-Valid")).not.toBeInTheDocument();
  });

  it("shows IDLE for all stages when not analyzing", () => {
    const { container } = render(<IncineratorTab isAnalyzing={false} onAnalyze={mockOnAnalyze} />);
    const idleLabels = container.querySelectorAll(".uppercase");
    const texts = Array.from(idleLabels).map(el => el.textContent?.trim());
    expect(texts.filter(t => t?.includes("IDLE"))).toHaveLength(3);
  });

  it("shows ACTIVE for all stages when analyzing", () => {
    const { container } = render(<IncineratorTab isAnalyzing={true} onAnalyze={mockOnAnalyze} />);
    const labels = container.querySelectorAll(".uppercase");
    const texts = Array.from(labels).map(el => el.textContent?.trim());
    expect(texts.filter(t => t?.includes("ACTIVE"))).toHaveLength(3);
    expect(texts.filter(t => t?.includes("IDLE"))).toHaveLength(0);
  });

  it("passes active=true to IncineratorViz when analyzing", () => {
    render(<IncineratorTab isAnalyzing={true} onAnalyze={mockOnAnalyze} />);
    expect(screen.getByTestId("incinerator-viz").getAttribute("data-active")).toBe("true");
  });

  it("renders mobile variant", () => {
    render(<IncineratorTab isAnalyzing={false} onAnalyze={mockOnAnalyze} mobile />);
    expect(screen.getByTestId("aegis-incinerator-heading")).toBeInTheDocument();
  });
});
