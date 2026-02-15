"use client";
import React from "react";
import { useWindowSize } from "@/hooks/useWindowSize";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { ShieldIcon, SearchIcon, FireIcon, RSSIcon, ChartIcon } from "@/components/icons";
import { colors, fonts, space } from "@/styles/theme";
import type { NavItem } from "./Sidebar";

interface AppShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

const NAV_CONFIG = [
  { id: "dashboard", Icon: ShieldIcon, label: "Home", description: "Your Agent's Report" },
  { id: "briefing", Icon: SearchIcon, label: "Briefing", description: "AI-curated priority reading" },
  { id: "incinerator", Icon: FireIcon, label: "Burn", description: "Analyze & publish signals" },
  { id: "sources", Icon: RSSIcon, label: "Sources", description: "RSS, Nostr & URL sources" },
  { id: "analytics", Icon: ChartIcon, label: "Stats", description: "Filter accuracy & analytics" },
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

      <main style={{
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
