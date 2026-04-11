/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

afterEach(() => cleanup());

describe("InfoTooltip", () => {
  it("renders the info icon and tooltip text", () => {
    render(<InfoTooltip text="Helpful explanation" />);
    expect(screen.getByText("i")).toBeInTheDocument();
    expect(screen.getByText("Helpful explanation")).toBeInTheDocument();
  });

  it("exposes role=button with Info aria-label and is keyboard focusable", () => {
    render(<InfoTooltip text="x" />);
    const wrapper = screen.getByLabelText("Info");
    expect(wrapper).toHaveAttribute("role", "button");
    expect(wrapper).toHaveAttribute("tabIndex", "0");
  });

  it("renders tooltip body with role=tooltip", () => {
    render(<InfoTooltip text="Body text" />);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Body text");
  });

  it("desktop variant uses CSS hover (no onClick toggle)", () => {
    render(<InfoTooltip text="x" />);
    const wrap = screen.getByLabelText("Info");
    expect(wrap.className).toContain("aegis-tooltip-wrap");
    const tip = screen.getByRole("tooltip");
    expect(tip.className).toContain("opacity-0");
  });

  it("mobile variant toggles open on click", () => {
    render(<InfoTooltip text="x" mobile />);
    const wrap = screen.getByLabelText("Info");
    expect(wrap.className).not.toContain("aegis-tooltip-wrap");
    const tip = screen.getByRole("tooltip");
    expect(tip.className).toContain("opacity-0");
    fireEvent.click(wrap);
    expect(tip.className).toContain("opacity-100");
    fireEvent.click(wrap);
    expect(tip.className).toContain("opacity-0");
  });

  it("Enter key toggles tooltip open/closed", () => {
    render(<InfoTooltip text="x" mobile />);
    const wrap = screen.getByLabelText("Info");
    const tip = screen.getByRole("tooltip");
    fireEvent.keyDown(wrap, { key: "Enter" });
    expect(tip.className).toContain("opacity-100");
    fireEvent.keyDown(wrap, { key: "Enter" });
    expect(tip.className).toContain("opacity-0");
  });

  it("Space key toggles tooltip", () => {
    render(<InfoTooltip text="x" mobile />);
    const wrap = screen.getByLabelText("Info");
    fireEvent.keyDown(wrap, { key: " " });
    expect(screen.getByRole("tooltip").className).toContain("opacity-100");
  });

  it("other keys do not toggle", () => {
    render(<InfoTooltip text="x" mobile />);
    const wrap = screen.getByLabelText("Info");
    fireEvent.keyDown(wrap, { key: "a" });
    expect(screen.getByRole("tooltip").className).toContain("opacity-0");
  });

  it("clicking outside closes the open tooltip", () => {
    render(
      <div>
        <InfoTooltip text="x" mobile />
        <button data-testid="outside">other</button>
      </div>,
    );
    const wrap = screen.getByLabelText("Info");
    fireEvent.click(wrap);
    expect(screen.getByRole("tooltip").className).toContain("opacity-100");
    fireEvent.click(screen.getByTestId("outside"));
    expect(screen.getByRole("tooltip").className).toContain("opacity-0");
  });

  it("mobile uses right alignment, desktop uses left alignment", () => {
    const { rerender } = render(<InfoTooltip text="x" mobile />);
    expect(screen.getByRole("tooltip").className).toContain("right-0");
    rerender(<InfoTooltip text="x" />);
    expect(screen.getByRole("tooltip").className).toContain("left-0");
  });
});
