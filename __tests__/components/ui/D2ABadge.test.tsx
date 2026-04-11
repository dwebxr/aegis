import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { D2ABadge } from "@/components/ui/D2ABadge";

const wrap = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("D2ABadge", () => {
  it("renders D2A label and arrow on desktop (mobile=false)", () => {
    const html = wrap(<D2ABadge />);
    expect(html).toContain("D2A");
    // U+21C4 = ⇄ (rightwards arrow over leftwards arrow)
    expect(html).toContain("\u21C4");
  });

  it("hides D2A label when mobile prop is true", () => {
    const html = wrap(<D2ABadge mobile />);
    expect(html).toContain("\u21C4");
    expect(html).not.toContain(">D2A<");
  });

  it("uses purple-themed styling", () => {
    const html = wrap(<D2ABadge />);
    expect(html).toContain("text-purple-400");
    expect(html).toContain("bg-purple-400/10");
  });

  it("renders inline (span)", () => {
    const html = wrap(<D2ABadge />);
    expect(html.startsWith("<span")).toBe(true);
  });

  it("explicit mobile={false} renders the same as omitted", () => {
    const a = wrap(<D2ABadge mobile={false} />);
    const b = wrap(<D2ABadge />);
    expect(a).toBe(b);
  });
});
