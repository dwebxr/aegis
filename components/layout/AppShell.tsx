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

const navItems: NavItem[] = [
  { id: "dashboard", icon: <ShieldIcon s={18} />, label: "Home" },
  { id: "briefing", icon: <SearchIcon s={18} />, label: "Briefing" },
  { id: "incinerator", icon: <FireIcon s={18} />, label: "Burn" },
  { id: "sources", icon: <RSSIcon s={18} />, label: "Sources" },
  { id: "analytics", icon: <ChartIcon s={18} />, label: "Stats" },
];

const mobileNavItems: NavItem[] = [
  { id: "dashboard", icon: <ShieldIcon s={22} />, label: "Home" },
  { id: "briefing", icon: <SearchIcon s={22} />, label: "Briefing" },
  { id: "incinerator", icon: <FireIcon s={22} />, label: "Burn" },
  { id: "sources", icon: <RSSIcon s={22} />, label: "Sources" },
  { id: "analytics", icon: <ChartIcon s={22} />, label: "Stats" },
];

export const AppShell: React.FC<AppShellProps> = ({ activeTab, onTabChange, children }) => {
  const { mobile, tablet } = useWindowSize();

  return (
    <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", height: "100vh", background: "#0a0f1e", fontFamily: "'Outfit','Noto Sans JP',-apple-system,sans-serif", color: "#e2e8f0", overflow: "hidden", position: "relative" }}>
      {!mobile && (
        <Sidebar navItems={navItems} activeTab={activeTab} onTabChange={onTabChange} collapsed={tablet} />
      )}

      <main style={{ flex: 1, overflow: "auto", padding: mobile ? "16px 14px 90px" : tablet ? "24px 24px" : "28px 32px" }}>
        {children}
      </main>

      {mobile && (
        <MobileNav navItems={mobileNavItems} activeTab={activeTab} onTabChange={onTabChange} />
      )}
    </div>
  );
};
