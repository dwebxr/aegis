/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { GlossaryModal, GlossaryButton } from "@/components/ui/GlossaryModal";
import { WithTooltip } from "../../helpers/withTooltip";

function renderOpen(onClose = jest.fn()) {
  const result = render(
    <WithTooltip>
      <GlossaryModal open={true} onClose={onClose} />
    </WithTooltip>,
  );
  // baseElement includes Radix Portal content (rendered outside container)
  return { el: result.baseElement, onClose };
}

describe("GlossaryModal", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { baseElement } = render(
      <WithTooltip>
        <GlossaryModal open={false} onClose={jest.fn()} />
      </WithTooltip>,
    );
    expect(baseElement.textContent).not.toContain("Glossary & Shortcuts");
  });

  it("renders title when open", () => {
    const { el } = renderOpen();
    expect(el.textContent).toContain("Glossary & Shortcuts");
  });

  it("renders all grade letters (A-F)", () => {
    const { el } = renderOpen();
    const html = el.innerHTML;
    ["A", "B", "C", "D", "F"].forEach(grade => {
      expect(html).toContain(`>${grade}<`);
    });
  });

  it("renders all grade score ranges", () => {
    const { el } = renderOpen();
    const text = el.textContent!;
    ["8.0 - 10", "6.0 - 7.9", "4.0 - 5.9", "2.0 - 3.9", "0 - 1.9"].forEach(range => {
      expect(text).toContain(range);
    });
  });

  it("renders grade descriptions", () => {
    const { el } = renderOpen();
    const text = el.textContent!;
    expect(text).toContain("Exceptional quality");
    expect(text).toContain("probable AI slop");
  });

  it("renders signal badges with SVG icons", () => {
    const { el } = renderOpen();
    const html = el.innerHTML;
    const signalSection = html.split("Signal Badges")[1]?.split("Metrics")[0] ?? "";
    const svgCount = (signalSection.match(/<svg/g) ?? []).length;
    expect(svgCount).toBeGreaterThanOrEqual(9);
  });

  it("renders all metric labels", () => {
    const { el } = renderOpen();
    const text = el.textContent!;
    ["Accuracy", "False Positive", "User Reviews", "V-Signal", "C-Context", "L-Slop", "Composite", "WoT", "D2A"].forEach(label => {
      expect(text).toContain(label);
    });
  });

  it("renders metric descriptions", () => {
    const { el } = renderOpen();
    const text = el.textContent!;
    expect(text).toContain("Percentage of evaluated content");
    expect(text).toContain("encrypted protocol for AI agents");
  });

  it("renders all keyboard shortcuts", () => {
    const { el } = renderOpen();
    const text = el.textContent!;
    expect(text).toContain("J / K");
    expect(text).toContain("Navigate cards");
    expect(text).toContain("Open source in new tab");
    expect(text).toContain("Command palette");
  });

  it("renders all 4 section headings", () => {
    const { el } = renderOpen();
    const html = el.innerHTML;
    ["Quality Grades", "Signal Badges", "Metrics", "Keyboard Shortcuts"].forEach(heading => {
      expect(html).toContain(heading);
    });
  });

  it("calls onClose when close button clicked", () => {
    const onClose = jest.fn();
    const { el } = renderOpen(onClose);
    const closeBtn = el.querySelector('[data-slot="dialog-close"]');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("GlossaryButton", () => {
  afterEach(cleanup);

  it("renders ? text and help icon", () => {
    const { container } = render(<GlossaryButton onClick={jest.fn()} />);
    expect(container.textContent).toContain("?");
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("calls onClick when clicked", () => {
    const onClick = jest.fn();
    const { container } = render(<GlossaryButton onClick={onClick} />);
    fireEvent.click(container.querySelector("button")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has accessible aria-label", () => {
    const { container } = render(<GlossaryButton onClick={jest.fn()} />);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toContain("glossary");
  });

  it("merges custom className", () => {
    const { container } = render(<GlossaryButton onClick={jest.fn()} className="mt-4" />);
    expect(container.querySelector("button")?.className).toContain("mt-4");
  });
});
