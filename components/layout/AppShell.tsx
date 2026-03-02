"use client";
import React, { useRef, useState } from "react";
import { useWindowSize } from "@/hooks/useWindowSize";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SyncStatusBanner } from "@/components/ui/SyncStatusBanner";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { ShieldIcon, SearchIcon, FireIcon, RSSIcon, D2AIcon } from "@/components/icons";
import { colors, fonts, space, type as t, radii, transitions } from "@/styles/theme";
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
  const mainRef = useRef<HTMLElement>(null);
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const [installDismissed, setInstallDismissed] = useState(false);
  const showInstallBanner = canInstall && !installed && !installDismissed;

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

      <main ref={mainRef} data-testid="aegis-main-content" style={{
        flex: 1, overflow: "auto",
        overscrollBehaviorY: "contain", // prevent native pull-to-refresh
        padding: mobile ? `${space[4]}px ${space[4]}px 100px` : tablet ? `${space[6]}px ${space[6]}px` : `${space[10]}px ${space[12]}px`,
      }}>
        <PullToRefresh scrollRef={mainRef} enabled={mobile}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            {showInstallBanner && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: `${space[2]}px ${space[4]}px`,
                background: `${colors.cyan[500]}10`,
                border: `1px solid ${colors.cyan[500]}25`,
                borderRadius: radii.md,
                marginBottom: space[3],
              }}>
                <span style={{ fontSize: t.caption.size, color: colors.text.secondary, fontWeight: 600 }}>
                  Install Aegis for faster access
                </span>
                <div style={{ display: "flex", gap: space[2], flexShrink: 0 }}>
                  <button
                    onClick={() => void promptInstall().catch(() => {/* user dismissed */})}
                    style={{
                      padding: `${space[1]}px ${space[3]}px`,
                      background: `${colors.cyan[500]}18`,
                      border: `1px solid ${colors.cyan[500]}33`,
                      borderRadius: radii.sm,
                      color: colors.cyan[400],
                      fontSize: t.caption.size,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: transitions.fast,
                    }}
                  >
                    Install
                  </button>
                  <button
                    onClick={() => setInstallDismissed(true)}
                    aria-label="Dismiss install banner"
                    style={{
                      padding: `${space[1]}px ${space[2]}px`,
                      background: "transparent",
                      border: "none",
                      color: colors.text.disabled,
                      fontSize: t.body.size,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      lineHeight: 1,
                    }}
                  >
                    &times;
                  </button>
                </div>
              </div>
            )}
            <SyncStatusBanner />
            {children}
          </div>
        </PullToRefresh>
      </main>

      {mobile && (
        <MobileNav navItems={buildNavItems(24)} activeTab={activeTab} onTabChange={onTabChange} />
      )}
    </div>
  );
};
