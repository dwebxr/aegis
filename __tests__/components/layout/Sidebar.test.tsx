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
import { Sidebar } from "@/components/layout/Sidebar";
import type { NavItem } from "@/components/layout/Sidebar";

// Mock useAuth
let mockAuth = { isAuthenticated: false };
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

// Mock auth components
jest.mock("@/components/auth/LoginButton", () => ({
  LoginButton: () => <button data-testid="login-btn">Login</button>,
}));
jest.mock("@/components/auth/UserBadge", () => ({
  UserBadge: () => <span data-testid="user-badge">User</span>,
}));

const navItems: NavItem[] = [
  { id: "dashboard", icon: <span>H</span>, label: "Home", description: "Overview" },
  { id: "briefing", icon: <span>B</span>, label: "Briefing" },
];

describe("Sidebar", () => {
  beforeEach(() => {
    mockAuth = { isAuthenticated: false };
  });

  it("renders all nav items", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("Home");
    expect(html).toContain("Briefing");
  });

  it("renders AEGIS branding", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("AEGIS");
    expect(html).toContain("v3.0");
  });

  it("hides labels when collapsed", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={true} />,
    );
    expect(html).not.toContain("Home");
    expect(html).not.toContain("Briefing");
    expect(html).not.toContain("AEGIS");
  });

  it("shows Stats button for unauthenticated users", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("Stats");
  });

  it("hides Settings button for unauthenticated users", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).not.toContain("Settings");
  });

  it("shows both Settings and Stats for authenticated users", () => {
    mockAuth = { isAuthenticated: true };
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("Settings");
    expect(html).toContain("Stats");
  });

  it("renders data-testid for footer nav buttons", () => {
    mockAuth = { isAuthenticated: true };
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("aegis-nav-settings");
    expect(html).toContain("aegis-nav-analytics");
  });

  it("renders GitHub link", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("github.com/dwebxr/aegis");
    expect(html).toContain("GitHub");
  });

  it("renders Online status indicator", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("Online");
    expect(html).toContain("Aegis AI");
  });

  it("shows LoginButton when not authenticated", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("login-btn");
  });

  it("shows UserBadge when authenticated", () => {
    mockAuth = { isAuthenticated: true };
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("user-badge");
  });

  it("highlights active nav item", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    // Active item has blue color and bold weight
    expect(html).toContain("rgba(37,99,235,0.12)");
  });

  it("renders description for nav items that have one", () => {
    const html = renderToStaticMarkup(
      <Sidebar navItems={navItems} activeTab="dashboard" onTabChange={jest.fn()} collapsed={false} />,
    );
    expect(html).toContain("Overview");
  });
});
