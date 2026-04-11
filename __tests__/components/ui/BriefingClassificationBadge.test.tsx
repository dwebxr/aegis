import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefingClassificationBadge } from "@/components/ui/BriefingClassificationBadge";

const wrap = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("BriefingClassificationBadge", () => {
  it("renders YOUR EXPERTISE label for familiar classification", () => {
    const html = wrap(<BriefingClassificationBadge classification="familiar" />);
    expect(html).toContain("YOUR EXPERTISE");
    expect(html).toContain("text-blue-400");
    expect(html).toContain("border-blue-500/20");
  });

  it("renders NEW HORIZON label for novel classification", () => {
    const html = wrap(<BriefingClassificationBadge classification="novel" />);
    expect(html).toContain("NEW HORIZON");
    expect(html).toContain("text-purple-400");
    expect(html).toContain("border-purple-500/20");
  });

  it("renders nothing for mixed classification (returns null)", () => {
    const html = wrap(<BriefingClassificationBadge classification="mixed" />);
    expect(html).toBe("");
  });

  it("uses different color classes for familiar vs novel", () => {
    const familiar = wrap(<BriefingClassificationBadge classification="familiar" />);
    const novel = wrap(<BriefingClassificationBadge classification="novel" />);
    expect(familiar).not.toContain("text-purple-400");
    expect(novel).not.toContain("text-blue-400");
  });

  it("renders as a span element", () => {
    const html = wrap(<BriefingClassificationBadge classification="familiar" />);
    expect(html.startsWith("<span")).toBe(true);
  });
});
