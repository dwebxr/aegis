import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrustTierBadge } from "@/components/ui/TrustTierBadge";
import type { TrustTier } from "@/lib/d2a/reputation";

const wrap = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("TrustTierBadge", () => {
  const tiers: { tier: TrustTier; label: string; color: string }[] = [
    { tier: "trusted", label: "Trusted", color: "text-green-400" },
    { tier: "known", label: "Known", color: "text-cyan-400" },
    { tier: "unknown", label: "Unknown", color: "text-disabled" },
    { tier: "restricted", label: "Restricted", color: "text-red-400" },
  ];

  it.each(tiers)("renders $label label for $tier tier", ({ tier, label }) => {
    const html = wrap(<TrustTierBadge tier={tier} />);
    expect(html).toContain(label);
  });

  it.each(tiers)("applies $color class for $tier tier", ({ tier, color }) => {
    const html = wrap(<TrustTierBadge tier={tier} />);
    expect(html).toContain(color);
  });

  it("uses uppercase styling", () => {
    const html = wrap(<TrustTierBadge tier="trusted" />);
    expect(html).toContain("uppercase");
  });

  it("renders as a span element with rounded-full border", () => {
    const html = wrap(<TrustTierBadge tier="known" />);
    expect(html.startsWith("<span")).toBe(true);
    expect(html).toContain("rounded-full");
    expect(html).toContain("border");
  });

  it("does not bleed colors between tiers", () => {
    const trusted = wrap(<TrustTierBadge tier="trusted" />);
    const restricted = wrap(<TrustTierBadge tier="restricted" />);
    expect(trusted).not.toContain("text-red-400");
    expect(restricted).not.toContain("text-green-400");
  });
});
