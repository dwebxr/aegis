"use client";
import React from "react";
import { useWindowSize } from "@/hooks/useWindowSize";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { ShieldIcon, SearchIcon, FireIcon, RSSIcon, ChartIcon } from "@/components/icons";
import type { NavItem } from "./Sidebar";

interface AppShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

const NAV_CONFIG = [
  { id: "dashboard", Icon: ShieldIcon, label: "Home" },
  { id: "briefing", Icon: SearchIcon, label: "Briefing" },
  { id: "incinerator", Icon: FireIcon, label: "Burn" },
  { id: "sources", Icon: RSSIcon, label: "Sources" },
  { id: "analytics", Icon: ChartIcon, label: "Stats" },
] as const;

function buildNavItems(size: number): NavItem[] {
  return NAV_CONFIG.map(n => ({ id: n.id, icon: <n.Icon s={size} />, label: n.label }));
}

export const AppShell: React.FC<AppShellProps> = ({ activeTab, onTabChange, children }) => {
  const { mobile, tablet } = useWindowSize();

  return (
    <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", height: "100vh", background: "#0a0f1e", fontFamily: "'Outfit','Noto Sans JP',-apple-system,sans-serif", color: "#e2e8f0", overflow: "hidden", position: "relative" }}>
      {!mobile && (
        <Sidebar navItems={buildNavItems(18)} activeTab={activeTab} onTabChange={onTabChange} collapsed={tablet} />
      )}

      <main style={{ flex: 1, overflow: "auto", padding: mobile ? "16px 14px 90px" : tablet ? "24px 24px" : "28px 32px" }}>
        {children}
      </main>

      {mobile && (
        <MobileNav navItems={buildNavItems(22)} activeTab={activeTab} onTabChange={onTabChange} />
      )}
    </div>
  );
};
