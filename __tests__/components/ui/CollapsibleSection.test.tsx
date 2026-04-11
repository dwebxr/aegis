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
import { CollapsibleSection, SectionSkeleton } from "@/components/ui/CollapsibleSection";

afterEach(() => cleanup());

const baseProps = {
  id: "feeds",
  title: "RSS Feeds",
  icon: "📡",
  isExpanded: false,
  onToggle: jest.fn(),
};

describe("CollapsibleSection", () => {
  it("renders title, icon, and data-testid suffixed with id", () => {
    render(
      <CollapsibleSection {...baseProps}>
        <p>child</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("RSS Feeds")).toBeInTheDocument();
    expect(screen.getByText("📡")).toBeInTheDocument();
    expect(screen.getByTestId("aegis-section-feeds")).toBeInTheDocument();
  });

  it("hides children when isExpanded=false", () => {
    render(
      <CollapsibleSection {...baseProps}>
        <p>secret</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("shows children when isExpanded=true", () => {
    render(
      <CollapsibleSection {...baseProps} isExpanded>
        <p>secret</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("clicking header calls onToggle with the section id", () => {
    const onToggle = jest.fn();
    render(
      <CollapsibleSection {...baseProps} onToggle={onToggle}>
        <p>x</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByText("RSS Feeds"));
    expect(onToggle).toHaveBeenCalledWith("feeds");
  });

  it("renders item count when itemCount > 0", () => {
    render(
      <CollapsibleSection {...baseProps} itemCount={7}>
        <p>x</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("hides count badge when itemCount is 0", () => {
    render(
      <CollapsibleSection {...baseProps} itemCount={0}>
        <p>x</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("hides count badge when itemCount is undefined", () => {
    render(
      <CollapsibleSection {...baseProps}>
        <p>x</p>
      </CollapsibleSection>,
    );
    const header = screen.getByText("RSS Feeds").parentElement as HTMLElement;
    expect(header.querySelectorAll("span").length).toBeLessThanOrEqual(3);
  });

  it("shows action button only when expanded and actionButton supplied", () => {
    const onClick = jest.fn();
    const action = { label: "Add", onClick };
    const { rerender } = render(
      <CollapsibleSection {...baseProps} actionButton={action}>
        <p>x</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("Add")).not.toBeInTheDocument();

    rerender(
      <CollapsibleSection {...baseProps} isExpanded actionButton={action}>
        <p>x</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("clicking action button does NOT trigger onToggle (stops propagation)", () => {
    const onToggle = jest.fn();
    const onAction = jest.fn();
    render(
      <CollapsibleSection
        {...baseProps}
        isExpanded
        onToggle={onToggle}
        actionButton={{ label: "Add", onClick: onAction }}
      >
        <p>x</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByText("Add"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("uses larger icon class on mobile", () => {
    render(
      <CollapsibleSection {...baseProps} mobile>
        <p>x</p>
      </CollapsibleSection>,
    );
    const icon = screen.getByText("📡");
    expect(icon.className).toContain("text-base");
  });

  it("uses smaller icon class on desktop", () => {
    render(
      <CollapsibleSection {...baseProps}>
        <p>x</p>
      </CollapsibleSection>,
    );
    const icon = screen.getByText("📡");
    expect(icon.className).toContain("text-sm");
  });

  it("forwards wrapperRef", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <CollapsibleSection {...baseProps} wrapperRef={ref}>
        <p>x</p>
      </CollapsibleSection>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.dataset.testid).toBe("aegis-section-feeds");
  });
});

describe("SectionSkeleton", () => {
  it("renders three placeholder bars", () => {
    const { container } = render(<SectionSkeleton />);
    const bars = container.querySelectorAll("div[style]");
    expect(bars).toHaveLength(3);
  });

  it("uses larger height class when mobile=true", () => {
    const { container } = render(<SectionSkeleton mobile />);
    const bars = container.querySelectorAll("div.h-20");
    expect(bars.length).toBeGreaterThan(0);
  });

  it("uses smaller height class when mobile=false", () => {
    const { container } = render(<SectionSkeleton />);
    const bars = container.querySelectorAll("div.h-15");
    expect(bars.length).toBeGreaterThan(0);
  });
});
