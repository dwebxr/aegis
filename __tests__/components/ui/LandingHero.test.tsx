import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingHero } from "@/components/ui/LandingHero";

describe("LandingHero", () => {
  const noop = () => {};

  it("renders heading", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Survive What");
    expect(html).toContain("Coming");
  });

  it("renders all 4 feature cards", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Quality Filter");
    expect(html).toContain("Nostr Publishing");
    expect(html).toContain("Web of Trust");
    expect(html).toContain("D2A Agents");
  });

  it("renders feature descriptions", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("AI evaluates content for originality");
    expect(html).toContain("encrypted peer-to-peer protocols");
  });

  it("renders Explore Demo button", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Explore Demo");
  });

  it("renders Login button", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Login with Internet Identity");
  });

  it("renders in mobile mode without errors", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} mobile />
    );
    expect(html).toContain("Explore Demo");
  });

  it("renders footer with version and OSS note", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Open Source");
    expect(html).toContain("v3.0");
  });
});
