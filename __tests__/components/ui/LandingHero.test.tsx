import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingHero } from "@/components/ui/LandingHero";

describe("LandingHero", () => {
  const noop = () => {};

  it("renders heading", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Cut Through the Noise");
  });

  it("renders tagline", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("quality filter for RSS and social feeds");
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
    expect(html).toContain("Automatically removes clickbait");
    expect(html).toContain("discovers, evaluates, and exchanges");
  });

  it("renders what-you-get section", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("What You Get");
    expect(html).toContain("Daily Reading List");
    expect(html).toContain("Share Quality Signals");
  });

  it("renders Try the Demo button", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Try the Demo");
  });

  it("renders Login link", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("sign in with Internet Identity");
  });

  it("renders in mobile mode without errors", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} mobile />
    );
    expect(html).toContain("Try the Demo");
  });

  it("renders footer with version and translation hint", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("v3.0");
    expect(html).toContain("translate feature");
  });

  it("renders how-it-works steps", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Add Your Feeds");
    expect(html).toContain("AI Filters the Noise");
    expect(html).toContain("Read What Matters");
  });

  it("renders trust block", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Non-Custodial");
    expect(html).toContain("No Tracking");
  });

  it("renders persona use cases", () => {
    const html = renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} />
    );
    expect(html).toContain("Crypto Trader");
    expect(html).toContain("Researcher");
    expect(html).toContain("Newsletter Writer");
  });
});
