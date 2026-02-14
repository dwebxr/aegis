import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Tooltip } from "@/components/ui/Tooltip";

describe("Tooltip", () => {
  it("renders children content", () => {
    const html = renderToStaticMarkup(
      <Tooltip text="Help text"><span>Label</span></Tooltip>
    );
    expect(html).toContain("Label");
  });

  it("renders tooltip text in the DOM", () => {
    const html = renderToStaticMarkup(
      <Tooltip text="Explanation here"><span>Hover me</span></Tooltip>
    );
    expect(html).toContain("Explanation here");
  });

  it("tooltip has opacity 0 by default", () => {
    const html = renderToStaticMarkup(
      <Tooltip text="Tip"><span>X</span></Tooltip>
    );
    expect(html).toContain("opacity:0");
  });

  it("wraps children in a span with position relative", () => {
    const html = renderToStaticMarkup(
      <Tooltip text="Tip"><span>X</span></Tooltip>
    );
    expect(html).toContain("position:relative");
  });

  it("renders CSS class names for hover transition (style in globals.css)", () => {
    const html = renderToStaticMarkup(
      <Tooltip text="Tip"><span>X</span></Tooltip>
    );
    expect(html).toContain("aegis-tooltip-wrap");
    expect(html).toContain("aegis-tooltip-content");
  });

  it("uses bottom positioning for position=top (default)", () => {
    const html = renderToStaticMarkup(
      <Tooltip text="Tip"><span>X</span></Tooltip>
    );
    // position=top means tooltip appears above, so CSS "bottom" is set
    expect(html).toContain("bottom:calc(100% + 6px)");
  });

  it("uses top positioning for position=bottom", () => {
    const html = renderToStaticMarkup(
      <Tooltip text="Tip" position="bottom"><span>X</span></Tooltip>
    );
    expect(html).toContain("top:calc(100% + 6px)");
  });
});
