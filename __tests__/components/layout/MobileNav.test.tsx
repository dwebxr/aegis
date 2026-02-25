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
import { MobileNav } from "@/components/layout/MobileNav";
import type { NavItem } from "@/components/layout/Sidebar";

let mockAuth = {
  isAuthenticated: false,
  principalText: "",
  login: jest.fn(),
  logout: jest.fn(),
};

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

const navItems: NavItem[] = [
  { id: "dashboard", icon: <span>H</span>, label: "Home", description: "Overview" },
  { id: "briefing", icon: <span>B</span>, label: "Briefing" },
  { id: "d2a", icon: <span>D</span>, label: "D2A" },
];

describe("MobileNav", () => {
  beforeEach(() => {
    mockAuth = {
      isAuthenticated: false,
      principalText: "",
      login: jest.fn(),
      logout: jest.fn(),
    };
  });

  it("renders all nav items", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("Home");
    expect(html).toContain("Briefing");
    expect(html).toContain("D2A");
  });

  it("renders data-testid for each nav item", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("aegis-nav-mobile-dashboard");
    expect(html).toContain("aegis-nav-mobile-briefing");
    expect(html).toContain("aegis-nav-mobile-d2a");
  });

  it("shows login button when unauthenticated", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("Login with Internet Identity");
  });

  it("shows logout + footer buttons when authenticated", () => {
    mockAuth = {
      isAuthenticated: true,
      principalText: "abcde-12345-fghij-67890",
      login: jest.fn(),
      logout: jest.fn(),
    };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("Logout");
    // Footer buttons (Settings, Stats) rendered from footerButtons config
    expect(html).toContain("Settings");
    expect(html).toContain("Stats");
  });

  it("truncates long principal text", () => {
    mockAuth = {
      isAuthenticated: true,
      principalText: "abcdefghijklmnop",
      login: jest.fn(),
      logout: jest.fn(),
    };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    // Should show truncated: first 4 + ".." + last 3
    expect(html).toContain("abcd..nop");
  });

  it("shows full short principal text without truncation", () => {
    mockAuth = {
      isAuthenticated: true,
      principalText: "short",
      login: jest.fn(),
      logout: jest.fn(),
    };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("short");
  });

  it("renders GitHub OSS link", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("github.com/dwebxr/aegis");
    expect(html).toContain("OSS");
  });

  it("highlights active tab with blue color and underline indicator", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="briefing" onTabChange={jest.fn()} />,
    );
    // Active tab has active color (hex in SSR output)
    expect(html).toContain("#60a5fa");
  });

  it("highlights active footer button (settings)", () => {
    mockAuth = {
      isAuthenticated: true,
      principalText: "abcde-12345-fghij",
      login: jest.fn(),
      logout: jest.fn(),
    };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="settings" onTabChange={jest.fn()} />,
    );
    // Settings button should have active background
    expect(html).toContain("rgba(37,99,235,0.12)");
  });

  it("renders with empty nav items", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={[]} activeTab="" onTabChange={jest.fn()} />,
    );
    // Should still render the nav structure without crashing
    expect(html).toContain("nav");
  });
});
