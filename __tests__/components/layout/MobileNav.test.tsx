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
  login: jest.fn(),
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
      login: jest.fn(),
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

  it("does not show social links or GitHub when unauthenticated", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).not.toContain("discord.gg");
    expect(html).not.toContain("github.com/dwebxr/aegis");
  });

  it("shows footer buttons when authenticated", () => {
    mockAuth = { isAuthenticated: true, login: jest.fn() };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("Settings");
    expect(html).toContain("Stats");
  });

  it("does not show logout button (moved to Settings)", () => {
    mockAuth = { isAuthenticated: true, login: jest.fn() };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).not.toContain("Logout");
  });

  it("renders social links when authenticated", () => {
    mockAuth = { isAuthenticated: true, login: jest.fn() };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("discord.gg/85JVzJaatT");
    expect(html).toContain("medium.com/aegis-ai");
    expect(html).toContain("x.com/Coo_aiagent");
  });

  it("renders social links with target=_blank and rel=noopener", () => {
    mockAuth = { isAuthenticated: true, login: jest.fn() };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    const discordLink = html.match(/<a[^>]*discord\.gg[^>]*>/)?.[0] || "";
    expect(discordLink).toContain('target="_blank"');
    expect(discordLink).toContain('rel="noopener noreferrer"');
  });

  it("renders GitHub OSS link when authenticated", () => {
    mockAuth = { isAuthenticated: true, login: jest.fn() };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("github.com/dwebxr/aegis");
    expect(html).toContain("OSS");
  });

  it("highlights active tab with blue color", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="briefing" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("text-blue-400");
  });

  it("highlights active footer button (settings)", () => {
    mockAuth = { isAuthenticated: true, login: jest.fn() };
    const html = renderToStaticMarkup(
      <MobileNav navItems={navItems} activeTab="settings" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("bg-blue-600/[0.12]");
  });

  it("renders with empty nav items", () => {
    const html = renderToStaticMarkup(
      <MobileNav navItems={[]} activeTab="" onTabChange={jest.fn()} />,
    );
    expect(html).toContain("nav");
  });
});
