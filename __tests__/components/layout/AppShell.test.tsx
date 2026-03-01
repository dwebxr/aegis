/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let mockWindowSize = { mobile: false, tablet: false };

jest.mock("@/hooks/useWindowSize", () => ({
  useWindowSize: () => mockWindowSize,
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    principalText: "",
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

import { AppShell } from "@/components/layout/AppShell";

describe("AppShell — desktop layout", () => {
  beforeEach(() => {
    mockWindowSize = { mobile: false, tablet: false };
  });

  it("renders children", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div data-testid="child">Hello</div>
      </AppShell>,
    );
    expect(html).toContain("Hello");
  });

  it("renders Sidebar on desktop", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("Home");
    expect(html).toContain("Briefing");
    expect(html).toContain("Burn");
    expect(html).toContain("D2A");
    expect(html).toContain("Sources");
  });

  it("renders main content area with data-testid", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("aegis-main-content");
  });

  it("does NOT render MobileNav on desktop", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).not.toContain("aegis-nav-mobile-");
  });

  it("wraps content with max-width container", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("max-width:1200px");
  });

  it("PullToRefresh disabled on desktop (no pull indicator text)", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("Content");
    expect(html).not.toContain("Pull to refresh");
  });

  it("applies overscroll-behavior-y:contain to main", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("overscroll-behavior-y:contain");
  });

  it("uses row flex direction on desktop", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("flex-direction:row");
  });
});

describe("AppShell — mobile layout", () => {
  beforeEach(() => {
    mockWindowSize = { mobile: true, tablet: false };
  });

  it("renders MobileNav on mobile", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("aegis-nav-mobile-dashboard");
  });

  it("does NOT render Sidebar on mobile", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).not.toContain("aegis-sidebar");
  });

  it("uses column flex direction on mobile", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("flex-direction:column");
  });

  it("renders PullToRefresh with enabled=true on mobile", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("Pull to refresh");
  });

  it("applies 100px bottom padding for mobile nav clearance", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toMatch(/padding:\d+px \d+px 100px/);
  });
});

describe("AppShell — tablet layout", () => {
  beforeEach(() => {
    mockWindowSize = { mobile: false, tablet: true };
  });

  it("renders collapsed Sidebar on tablet (icon-only, no labels)", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("aegis-nav-dashboard");
    expect(html).toContain("aegis-nav-briefing");
    expect(html).toContain("width:68px");
  });

  it("does NOT render MobileNav on tablet", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).not.toContain("aegis-nav-mobile-");
  });

  it("uses row flex direction on tablet", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).toContain("flex-direction:row");
  });

  it("renders PullToRefresh disabled on tablet", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>Content</div>
      </AppShell>,
    );
    expect(html).not.toContain("Pull to refresh");
  });
});

describe("AppShell — nav configuration", () => {
  beforeEach(() => {
    mockWindowSize = { mobile: false, tablet: false };
  });

  it("renders all 5 navigation items", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        <div>X</div>
      </AppShell>,
    );
    expect(html).toContain("Home");
    expect(html).toContain("Briefing");
    expect(html).toContain("Burn");
    expect(html).toContain("D2A");
    expect(html).toContain("Sources");
  });

  it("highlights active tab in sidebar with blue color", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="briefing" onTabChange={jest.fn()}>
        <div>X</div>
      </AppShell>,
    );
    expect(html).toContain("aegis-nav-briefing");
    expect(html).toContain("rgba(37,99,235,0.12)");
  });

  it("renders with empty children", () => {
    const html = renderToStaticMarkup(
      <AppShell activeTab="dashboard" onTabChange={jest.fn()}>
        {null}
      </AppShell>,
    );
    expect(html).toContain("aegis-main-content");
  });
});
