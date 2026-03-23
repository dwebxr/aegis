/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { render, fireEvent } from "@testing-library/react";
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
  { id: "dashboard", icon: <span data-testid="icon-home">H</span>, label: "Home", description: "Overview" },
  { id: "briefing", icon: <span data-testid="icon-brief">B</span>, label: "Briefing" },
];

const renderSidebar = (props: Partial<React.ComponentProps<typeof Sidebar>> = {}) =>
  render(
    <Sidebar
      navItems={navItems}
      activeTab="dashboard"
      onTabChange={jest.fn()}
      collapsed={false}
      {...props}
    />,
  );

describe("Sidebar", () => {
  beforeEach(() => {
    mockAuth = { isAuthenticated: false };
  });

  it("renders all nav items with labels when expanded", () => {
    const { getByText } = renderSidebar();
    expect(getByText("Home")).toBeTruthy();
    expect(getByText("Briefing")).toBeTruthy();
  });

  it("renders AEGIS branding when expanded", () => {
    const { getByText } = renderSidebar();
    expect(getByText("AEGIS")).toBeTruthy();
    expect(getByText("v3.0")).toBeTruthy();
  });

  it("hides branding text when collapsed", () => {
    const { queryByText } = renderSidebar({ collapsed: true });
    expect(queryByText("AEGIS")).toBeNull();
    expect(queryByText("v3.0")).toBeNull();
  });

  it("hides nav label text inside buttons when collapsed (labels move to tooltip)", () => {
    const { container } = renderSidebar({ collapsed: true });
    // In collapsed mode, label text is NOT inside the button children
    const buttons = container.querySelectorAll('button[data-testid^="aegis-nav-"]');
    buttons.forEach(btn => {
      expect(btn.textContent).not.toContain("Home");
      expect(btn.textContent).not.toContain("Briefing");
    });
  });

  it("shows Stats for unauthenticated users", () => {
    const { getByText } = renderSidebar();
    expect(getByText("Stats")).toBeTruthy();
  });

  it("hides Settings for unauthenticated users", () => {
    const { queryByText } = renderSidebar();
    expect(queryByText("Settings")).toBeNull();
  });

  it("shows both Settings and Stats for authenticated users", () => {
    mockAuth = { isAuthenticated: true };
    const { getByText } = renderSidebar();
    expect(getByText("Settings")).toBeTruthy();
    expect(getByText("Stats")).toBeTruthy();
  });

  it("renders data-testid for nav items", () => {
    const { container } = renderSidebar();
    expect(container.querySelector('[data-testid="aegis-nav-dashboard"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="aegis-nav-briefing"]')).toBeTruthy();
  });

  it("renders data-testid for footer nav", () => {
    mockAuth = { isAuthenticated: true };
    const { container } = renderSidebar();
    expect(container.querySelector('[data-testid="aegis-nav-settings"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="aegis-nav-analytics"]')).toBeTruthy();
  });

  it("renders GitHub link", () => {
    const { container } = renderSidebar();
    const link = container.querySelector('a[href*="github.com/dwebxr/aegis"]');
    expect(link).toBeTruthy();
  });

  it("renders Online status indicator when expanded", () => {
    const { getByText } = renderSidebar();
    expect(getByText("Online")).toBeTruthy();
    expect(getByText("Aegis AI")).toBeTruthy();
  });

  it("renders pulse dot in collapsed mode", () => {
    const { container } = renderSidebar({ collapsed: true });
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("shows LoginButton when not authenticated", () => {
    const { getByTestId } = renderSidebar();
    expect(getByTestId("login-btn")).toBeTruthy();
  });

  it("shows UserBadge when authenticated", () => {
    mockAuth = { isAuthenticated: true };
    const { getByTestId } = renderSidebar();
    expect(getByTestId("user-badge")).toBeTruthy();
  });

  it("hides auth section when collapsed", () => {
    mockAuth = { isAuthenticated: true };
    const { queryByTestId } = renderSidebar({ collapsed: true });
    expect(queryByTestId("user-badge")).toBeNull();
  });

  it("highlights active nav item with blue styling", () => {
    const { container } = renderSidebar({ activeTab: "dashboard" });
    const activeBtn = container.querySelector('[data-testid="aegis-nav-dashboard"]');
    expect(activeBtn?.className).toContain("text-blue-400");
  });

  it("does not highlight inactive nav item", () => {
    const { container } = renderSidebar({ activeTab: "dashboard" });
    const inactiveBtn = container.querySelector('[data-testid="aegis-nav-briefing"]');
    expect(inactiveBtn?.className).toContain("text-disabled");
  });

  it("calls onTabChange when nav item clicked", () => {
    const onTabChange = jest.fn();
    const { container } = renderSidebar({ onTabChange });
    fireEvent.click(container.querySelector('[data-testid="aegis-nav-briefing"]')!);
    expect(onTabChange).toHaveBeenCalledWith("briefing");
  });

  it("calls onTabChange for footer nav", () => {
    const onTabChange = jest.fn();
    const { container } = renderSidebar({ onTabChange });
    fireEvent.click(container.querySelector('[data-testid="aegis-nav-analytics"]')!);
    expect(onTabChange).toHaveBeenCalledWith("analytics");
  });

  it("renders social links with target=_blank", () => {
    const { container } = renderSidebar();
    const links = container.querySelectorAll('a[target="_blank"]');
    expect(links.length).toBeGreaterThanOrEqual(3); // discord, medium, x, github
  });

  it("renders social links in collapsed mode too", () => {
    const { container } = renderSidebar({ collapsed: true });
    const socialLinks = container.querySelectorAll('a[target="_blank"]');
    expect(socialLinks.length).toBeGreaterThanOrEqual(3);
  });

  it("has aria-label on all nav buttons", () => {
    const { container } = renderSidebar({ collapsed: true });
    const navBtns = container.querySelectorAll('button[aria-label]');
    expect(navBtns.length).toBeGreaterThanOrEqual(2);
  });

  it("applies wider width when expanded (200px)", () => {
    const { container } = renderSidebar();
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("w-[200px]");
  });

  it("applies narrow width when collapsed (68px)", () => {
    const { container } = renderSidebar({ collapsed: true });
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("w-[68px]");
  });
});
