"use client";
import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useWindowSize } from "@/hooks/useWindowSize";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SyncStatusBanner } from "@/components/ui/SyncStatusBanner";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { ShieldIcon, SearchIcon, FireIcon, RSSIcon, D2AIcon } from "@/components/icons";
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
    <div className={cn(
      "flex h-screen bg-background font-sans text-secondary-foreground overflow-hidden relative",
      mobile ? "flex-col" : "flex-row"
    )}>
      {!mobile && (
        <Sidebar navItems={buildNavItems(20)} activeTab={activeTab} onTabChange={onTabChange} collapsed={tablet} />
      )}

      <main
        ref={mainRef}
        data-testid="aegis-main-content"
        className={cn(
          "flex-1 overflow-auto overscroll-y-contain",
          mobile ? "px-4 pt-4 pb-[100px]" : tablet ? "p-6" : "px-12 py-10"
        )}
      >
        <PullToRefresh scrollRef={mainRef} enabled={mobile}>
          <div className="max-w-[1200px] mx-auto">
            {/* Install PWA banner */}
            {showInstallBanner && (
              <div className="flex items-center justify-between px-4 py-2 bg-cyan-500/[0.06] border border-cyan-500/[0.15] rounded-md mb-3">
                <span className="text-caption text-secondary-foreground font-semibold">
                  Install Aegis for faster access
                </span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => void promptInstall().catch(() => {/* user dismissed */})}
                    className="px-3 py-1 bg-cyan-500/[0.09] border border-cyan-500/20 rounded-sm text-cyan-400 text-caption font-bold cursor-pointer font-[inherit] transition-all duration-150 hover:bg-cyan-500/[0.15]"
                  >
                    Install
                  </button>
                  <button
                    onClick={() => setInstallDismissed(true)}
                    aria-label="Dismiss install banner"
                    className="px-2 py-1 bg-transparent border-none text-[var(--color-text-disabled)] text-body cursor-pointer font-[inherit] leading-none hover:text-[var(--color-text-tertiary)]"
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
