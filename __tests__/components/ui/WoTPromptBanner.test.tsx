import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WoTPromptBanner } from "@/components/ui/WoTPromptBanner";

describe("WoTPromptBanner", () => {
  const noop = () => {};

  it("renders prompt text and Link Account button", () => {
    const html = renderToStaticMarkup(
      <WoTPromptBanner onGoToSettings={noop} onDismiss={noop} />
    );
    expect(html).toContain("Link your Nostr account");
    expect(html).toContain("Link Account");
  });

  it("renders dismiss button", () => {
    const html = renderToStaticMarkup(
      <WoTPromptBanner onGoToSettings={noop} onDismiss={noop} />
    );
    expect(html).toContain("✕");
  });

  it("mentions Web of Trust", () => {
    const html = renderToStaticMarkup(
      <WoTPromptBanner onGoToSettings={noop} onDismiss={noop} />
    );
    expect(html).toContain("Web of Trust");
  });

  it("mentions trust-based content filtering", () => {
    const html = renderToStaticMarkup(
      <WoTPromptBanner onGoToSettings={noop} onDismiss={noop} />
    );
    expect(html).toContain("trust-based content filtering");
  });

  it("renders green-cyan gradient background", () => {
    const html = renderToStaticMarkup(
      <WoTPromptBanner onGoToSettings={noop} onDismiss={noop} />
    );
    expect(html).toContain("linear-gradient(135deg");
    expect(html).toContain("rgba(34,197,94,");
    expect(html).toContain("rgba(6,182,212,");
  });

  it("renders Link Account button with gradient fill", () => {
    const html = renderToStaticMarkup(
      <WoTPromptBanner onGoToSettings={noop} onDismiss={noop} />
    );
    // Button uses gradient from green[500] to cyan[500]
    expect(html).toContain("linear-gradient(135deg");
  });

  it("renders a green border", () => {
    const html = renderToStaticMarkup(
      <WoTPromptBanner onGoToSettings={noop} onDismiss={noop} />
    );
    expect(html).toContain("1px solid rgba(34,197,94,0.2)");
  });

  it("renders two buttons (Link Account + dismiss)", () => {
    const html = renderToStaticMarkup(
      <WoTPromptBanner onGoToSettings={noop} onDismiss={noop} />
    );
    const buttonMatches = html.match(/<button/g);
    expect(buttonMatches).not.toBeNull();
    expect(buttonMatches!.length).toBe(2);
  });
});
