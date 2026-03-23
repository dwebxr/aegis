import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SignalIcon, ContextIcon, NoiseIcon, SlopRiskIcon,
  OriginalIcon, InsightIcon, CredibleIcon, DerivativeIcon,
  BookmarkIcon, FlagIcon, ExternalLinkIcon, HelpCircleIcon,
} from "@/components/icons/signal";

const allIcons = [
  { name: "SignalIcon", Icon: SignalIcon },
  { name: "ContextIcon", Icon: ContextIcon },
  { name: "NoiseIcon", Icon: NoiseIcon },
  { name: "SlopRiskIcon", Icon: SlopRiskIcon },
  { name: "OriginalIcon", Icon: OriginalIcon },
  { name: "InsightIcon", Icon: InsightIcon },
  { name: "CredibleIcon", Icon: CredibleIcon },
  { name: "DerivativeIcon", Icon: DerivativeIcon },
  { name: "BookmarkIcon", Icon: BookmarkIcon },
  { name: "FlagIcon", Icon: FlagIcon },
  { name: "ExternalLinkIcon", Icon: ExternalLinkIcon },
  { name: "HelpCircleIcon", Icon: HelpCircleIcon },
];

describe("Signal icons", () => {
  it.each(allIcons)("$name renders an SVG", ({ Icon }) => {
    const html = renderToStaticMarkup(<Icon />);
    expect(html).toContain("<svg");
    expect(html).toContain("</svg>");
  });

  it.each(allIcons)("$name uses default size 14 (or 16 for HelpCircle)", ({ name, Icon }) => {
    const html = renderToStaticMarkup(<Icon />);
    const defaultSize = name === "HelpCircleIcon" ? 16 : 14;
    expect(html).toContain(`width="${defaultSize}"`);
    expect(html).toContain(`height="${defaultSize}"`);
  });

  it.each(allIcons)("$name accepts custom size", ({ Icon }) => {
    const html = renderToStaticMarkup(<Icon s={32} />);
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
  });

  it.each(allIcons)("$name uses stroke-based rendering", ({ Icon }) => {
    const html = renderToStaticMarkup(<Icon />);
    expect(html).toContain('stroke="currentColor"');
  });

  it("each icon produces unique SVG content", () => {
    const rendered = allIcons.map(({ Icon }) => renderToStaticMarkup(<Icon />));
    const unique = new Set(rendered);
    expect(unique.size).toBe(allIcons.length);
  });

  it("size=0 renders zero-size SVG", () => {
    const html = renderToStaticMarkup(<SignalIcon s={0} />);
    expect(html).toContain('width="0"');
  });
});
