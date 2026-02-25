"use client";
import React from "react";
import { useWindowSize } from "@/hooks/useWindowSize";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { ShieldIcon, SearchIcon, FireIcon, RSSIcon, D2AIcon } from "@/components/icons";
import { colors, fonts, space } from "@/styles/theme";
import type { NavItem } from "./Sidebar";

interface AppShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

const NAV_CONFIG = [
  { id: "dashboard", Icon: ShieldIcon, label: "Home", description: "Your daily overview" },
  { id: "briefing", Icon: SearchIcon, label: "Briefing", description: "Top picks for you" },
  { id: "incinerator", Icon: FireIcon, label: "Burn", description: "Filter and publish" },
  { id: "d2a", Icon: D2AIcon, label: "D2A", description: "Agent activity" },
  { id: "sources", Icon: RSSIcon, label: "Sources", description: "Add feeds and sources" },
] as const;

function buildNavItems(size: number): NavItem[] {
  return NAV_CONFIG.map(n => ({ id: n.id, icon: <n.Icon s={size} />, label: n.label, description: n.description }));
}

export const AppShell: React.FC<AppShellProps> = ({ activeTab, onTabChange, children }) => {
  const { mobile, tablet } = useWindowSize();

  return (
    <div style={{
      display: "flex", flexDirection: mobile ? "column" : "row",
      height: "100vh", background: colors.bg.root,
      fontFamily: fonts.sans, color: colors.text.secondary,
      overflow: "hidden", position: "relative",
    }}>
      {!mobile && (
        <Sidebar navItems={buildNavItems(20)} activeTab={activeTab} onTabChange={onTabChange} collapsed={tablet} />
      )}

      <main data-testid="aegis-main-content" style={{
        flex: 1, overflow: "auto",
        padding: mobile ? `${space[4]}px ${space[4]}px 100px` : tablet ? `${space[6]}px ${space[6]}px` : `${space[10]}px ${space[12]}px`,
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {children}
        </div>
      </main>

      {mobile && (
        <MobileNav navItems={buildNavItems(24)} activeTab={activeTab} onTabChange={onTabChange} />
      )}
    </div>
  );
};
