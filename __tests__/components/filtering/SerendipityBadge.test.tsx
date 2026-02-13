import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SerendipityBadge } from "@/components/filtering/SerendipityBadge";

describe("SerendipityBadge", () => {
  it("renders out_of_network badge with emoji and label", () => {
    const html = renderToStaticMarkup(<SerendipityBadge discoveryType="out_of_network" />);
    expect(html).toContain("\uD83D\uDD2D");
    expect(html).toContain("OUT OF NETWORK");
  });

  it("renders cross_language badge with emoji and label", () => {
    const html = renderToStaticMarkup(<SerendipityBadge discoveryType="cross_language" />);
    expect(html).toContain("\uD83C\uDF10");
    expect(html).toContain("CROSS-LANGUAGE");
  });

  it("renders emerging_topic badge with emoji and label", () => {
    const html = renderToStaticMarkup(<SerendipityBadge discoveryType="emerging_topic" />);
    expect(html).toContain("\uD83C\uDF31");
    expect(html).toContain("EMERGING TOPIC");
  });

  it("hides label in mobile mode, shows only emoji", () => {
    const html = renderToStaticMarkup(<SerendipityBadge discoveryType="out_of_network" mobile />);
    expect(html).toContain("\uD83D\uDD2D");
    expect(html).not.toContain("OUT OF NETWORK");
  });

  it("shows label in desktop mode", () => {
    const html = renderToStaticMarkup(<SerendipityBadge discoveryType="emerging_topic" mobile={false} />);
    expect(html).toContain("EMERGING TOPIC");
  });
});
