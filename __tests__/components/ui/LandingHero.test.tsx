import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingHero } from "@/components/ui/LandingHero";

describe("LandingHero", () => {
  const noop = () => {};

  function render(mobile?: boolean) {
    return renderToStaticMarkup(
      <LandingHero onTryDemo={noop} onLogin={noop} mobile={mobile} />
    );
  }

  /* ----------------------------------------------------------- */
  /* Content presence                                             */
  /* ----------------------------------------------------------- */

  it("renders heading", () => {
    expect(render()).toContain("Cut Through the Noise");
  });

  it("renders tagline", () => {
    expect(render()).toContain("quality filter for RSS and social feeds");
  });

  it("renders how-it-works steps", () => {
    const html = render();
    expect(html).toContain("Add your feeds");
    expect(html).toContain("AI filters out the slop");
    expect(html).toContain("Read only what matters");
  });

  it("renders all section headings", () => {
    const html = render();
    expect(html).toContain("Add RSS and social sources in one place");
    expect(html).toContain("AI that knows what");
    expect(html).toContain("Escape the infinite scroll");
    expect(html).toContain("The luxury of only reading what matters");
    expect(html).toContain("A new layer of signal");
    expect(html).toContain("Read anywhere, like a native app");
  });

  it("renders chrome extension and openness blocks", () => {
    const html = render();
    expect(html).toContain("Aegis Score for Chrome");
    expect(html).toContain("Non-Custodial");
    expect(html).toContain("No Tracking");
  });

  it("renders persona use cases", () => {
    const html = render();
    expect(html).toContain("Crypto traders");
    expect(html).toContain("Researchers");
    expect(html).toContain("Newsletter writers");
  });

  it("renders closing CTA", () => {
    const html = render();
    expect(html).toContain("Start collecting information for the next era");
    expect(html).toContain("Try the Demo for Free");
  });

  it("renders footer with version and translation hint", () => {
    const html = render();
    expect(html).toContain("v3.0");
    expect(html).toContain("translate feature");
  });

  it("renders social links in footer (Discord, Medium, X)", () => {
    const html = render();
    expect(html).toContain("discord.gg/85JVzJaatT");
    expect(html).toContain("medium.com/aegis-ai");
    expect(html).toContain("x.com/Coo_aiagent");
  });

  it("social links open in new tab", () => {
    const html = render();
    const xLink = html.match(/<a[^>]*x\.com\/Coo_aiagent[^>]*>/)?.[0] || "";
    expect(xLink).toContain('target="_blank"');
    expect(xLink).toContain('rel="noopener noreferrer"');
  });

  /* ----------------------------------------------------------- */
  /* Image src attributes point to real files                     */
  /* ----------------------------------------------------------- */

  it("renders all 7 image src attributes with correct paths", () => {
    const html = render();
    // Next.js Image URL-encodes the src into /_next/image?url=...
    const expectedImages = [
      "home-feed.png",
      "sources.png",
      "wot.png",
      "home-dashboard.png",
      "Briefing.png",
      "d2a.png",
      "mobile.png",
    ];
    for (const name of expectedImages) {
      expect(html).toContain(name);
    }
  });

  it("renders 7 img tags (1 hero + 6 feature sections)", () => {
    const html = render();
    // Next.js Image renders as <img> in SSR
    const imgCount = (html.match(/<img /g) || []).length;
    expect(imgCount).toBe(7);
  });

  /* ----------------------------------------------------------- */
  /* Button handler wiring                                        */
  /* ----------------------------------------------------------- */

  it("renders Try the Demo button with data-testid", () => {
    const html = render();
    expect(html).toMatch(/data-testid="aegis-landing-try-demo"/);
  });

  it("renders Login button with data-testid", () => {
    const html = render();
    expect(html).toMatch(/data-testid="aegis-landing-login"/);
  });

  it("renders two CTA buttons in hero section (Try Demo + Sign in)", () => {
    const html = render();
    expect(html).toContain("Try the Demo");
    expect(html).toContain("Sign in with Internet Identity");
  });

  /* ----------------------------------------------------------- */
  /* Mobile vs desktop layout differences                         */
  /* ----------------------------------------------------------- */

  it("desktop layout uses flex-row for hero", () => {
    const html = render(false);
    // Desktop: hero container should have flex-row
    expect(html).toContain("flex-row");
    // Desktop should NOT have the mobile-specific centered text class on hero
    expect(html).not.toMatch(/flex-col text-center.*pt-10/);
  });

  it("mobile layout uses flex-col for hero", () => {
    const html = render(true);
    // Mobile: hero should stack vertically
    expect(html).toContain("flex-col text-center");
  });

  it("mobile layout renders full-width buttons", () => {
    const html = render(true);
    // Both CTA buttons should be full-width on mobile
    const demoButton = html.match(/<button[^>]*aegis-landing-try-demo[^>]*>/)?.[0] || "";
    expect(demoButton).toContain("w-full");
    const loginButton = html.match(/<button[^>]*aegis-landing-login[^>]*>/)?.[0] || "";
    expect(loginButton).toContain("w-full");
  });

  it("desktop layout does NOT render full-width buttons", () => {
    const html = render(false);
    const demoButton = html.match(/<button[^>]*aegis-landing-try-demo[^>]*>/)?.[0] || "";
    expect(demoButton).not.toContain("w-full");
  });

  /* ----------------------------------------------------------- */
  /* Alternating image/text layout                                */
  /* ----------------------------------------------------------- */

  it("feature sections alternate image position on desktop", () => {
    const html = render(false);
    // Sections with imageFirst=true → flex-row (image left)
    // Sections with imageFirst=false → flex-row-reverse (image right)
    expect(html).toContain("flex-row-reverse");
    expect(html).toContain("flex-row");
  });

  /* ----------------------------------------------------------- */
  /* Image aspect ratios are correct (not hardcoded lies)         */
  /* ----------------------------------------------------------- */

  it("mobile.png image has portrait dimensions (height > width)", () => {
    const html = render();
    // mobile.png is 1070x1938, scaled to 535x969
    const mobileImg = html.match(/<img[^>]*mobile\.png[^>]*>/)?.[0] || "";
    const w = mobileImg.match(/width="(\d+)"/)?.[1];
    const h = mobileImg.match(/height="(\d+)"/)?.[1];
    expect(Number(h)).toBeGreaterThan(Number(w));
  });

  it("home-feed.png image has landscape dimensions (width > height)", () => {
    const html = render();
    const heroImg = html.match(/<img[^>]*home-feed\.png[^>]*>/)?.[0] || "";
    const w = heroImg.match(/width="(\d+)"/)?.[1];
    const h = heroImg.match(/height="(\d+)"/)?.[1];
    expect(Number(w)).toBeGreaterThan(Number(h));
  });

  it("square images have roughly equal width and height", () => {
    const html = render();
    for (const name of ["sources.png", "wot.png", "d2a.png"]) {
      const re = new RegExp(`<img[^>]*${name.replace(".", "\\.")}[^>]*>`);
      const img = html.match(re)?.[0] || "";
      const w = Number(img.match(/width="(\d+)"/)?.[1] || 0);
      const h = Number(img.match(/height="(\d+)"/)?.[1] || 0);
      const ratio = w / h;
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.1);
    }
  });

  /* ----------------------------------------------------------- */
  /* Portrait image constraint on desktop                         */
  /* ----------------------------------------------------------- */

  it("mobile.png container is width-constrained on desktop to prevent oversized portrait", () => {
    const html = render(false);
    // The div wrapping mobile.png should have max-w-[280px] on desktop
    const mobileImgSection = html.match(/<div[^>]*max-w-\[280px\][^>]*>[\s\S]*?mobile\.png/);
    expect(mobileImgSection).not.toBeNull();
  });

  it("mobile.png container is NOT width-constrained on mobile", () => {
    const html = render(true);
    // On mobile the container should not have max-w-[280px]
    const mobileImgSection = html.match(/<div[^>]*max-w-\[280px\][^>]*>[\s\S]*?mobile\.png/);
    expect(mobileImgSection).toBeNull();
  });

  /* ----------------------------------------------------------- */
  /* Buttons have type="button"                                   */
  /* ----------------------------------------------------------- */

  it("all buttons have explicit type=button", () => {
    const html = render();
    const buttons = html.match(/<button[^>]*>/g) || [];
    expect(buttons.length).toBeGreaterThanOrEqual(3); // hero demo, hero login, closing CTA
    for (const btn of buttons) {
      expect(btn).toContain('type="button"');
    }
  });
});
