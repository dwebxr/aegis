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

  it("renders tagline", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("AI noise filter for your feeds");
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
    expect(html).toContain("AI scores every article");
    expect(html).toContain("trades quality content with other agents");
  });

  it("renders what-you-can-do section", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("What you can do today");
    expect(html).toContain("AI-filtered reading list");
    expect(html).toContain("Publish quality signals");
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

  it("renders footer with version, OSS note, and translation hint", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Open Source");
    expect(html).toContain("v3.0");
    expect(html).toContain("translate feature");
  });
});
