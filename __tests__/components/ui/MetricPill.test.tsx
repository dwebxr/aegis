import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricPill } from "@/components/ui/MetricPill";
import { WithTooltip } from "../../helpers/withTooltip";

const wrap = (el: React.ReactElement) => renderToStaticMarkup(<WithTooltip>{el}</WithTooltip>);

describe("MetricPill", () => {
  it("renders numeric value", () => {
    const html = wrap(
      <MetricPill icon={<span>I</span>} value={42} tooltip="Total items" color="#22d3ee" />,
    );
    expect(html).toContain("42");
  });

  it("renders string value", () => {
    const html = wrap(
      <MetricPill icon={<span>I</span>} value="85%" tooltip="Accuracy" color="#34d399" />,
    );
    expect(html).toContain("85%");
  });

  it("renders zero value", () => {
    const html = wrap(
      <MetricPill icon={<span>I</span>} value={0} tooltip="Nothing yet" color="#ccc" />,
    );
    expect(html).toContain("0");
  });

  it("renders icon content", () => {
    const html = wrap(
      <MetricPill icon={<svg data-icon="test" />} value={10} tooltip="test" color="#aaa" />,
    );
    expect(html).toContain("data-icon");
  });

  it("applies color to background, border, and text", () => {
    const html = wrap(
      <MetricPill icon={<span>I</span>} value={5} tooltip="x" color="#f87171" />,
    );
    expect(html).toContain("#f87171");
    expect(html).toContain("color:#f87171");
  });

  it("contains aria-label matching tooltip", () => {
    const html = wrap(
      <MetricPill icon={<span>I</span>} value={5} tooltip="Items rated above threshold today" color="#aaa" />,
    );
    expect(html).toContain('aria-label="Items rated above threshold today"');
  });

  it("uses monospace font", () => {
    const html = wrap(
      <MetricPill icon={<span>I</span>} value={99} tooltip="x" color="#aaa" />,
    );
    expect(html).toContain("font-mono");
  });

  it("renders large numbers correctly", () => {
    const html = wrap(
      <MetricPill icon={<span>I</span>} value={1234567} tooltip="big" color="#aaa" />,
    );
    expect(html).toContain("1234567");
  });

  it("renders empty string value", () => {
    const html = wrap(
      <MetricPill icon={<span>I</span>} value="--" tooltip="no data" color="#aaa" />,
    );
    expect(html).toContain("--");
  });
});
