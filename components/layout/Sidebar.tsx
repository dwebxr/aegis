"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { ShieldIcon, GearIcon, ChartIcon, GitHubIcon } from "@/components/icons";
import { LoginButton } from "@/components/auth/LoginButton";
import { UserBadge } from "@/components/auth/UserBadge";
import { useAuth } from "@/contexts/AuthContext";

export interface NavItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
}

interface SidebarProps {
  navItems: NavItem[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  collapsed: boolean;
}

const footerNav = [
  { id: "settings", icon: <GearIcon s={16} />, label: "Settings", authOnly: true },
  { id: "analytics", icon: <ChartIcon s={16} />, label: "Stats", authOnly: false },
];

export const Sidebar: React.FC<SidebarProps> = ({ navItems, activeTab, onTabChange, collapsed }) => {
  const { isAuthenticated } = useAuth();
  return (
    <nav
      className={cn(
        "flex flex-col shrink-0 bg-[var(--color-bg-overlay)] backdrop-blur-[20px] border-r border-[var(--color-border-subtle)] transition-[width] duration-300",
        collapsed ? "w-[68px] px-2 py-5" : "w-[200px] px-3 py-6"
      )}
    >
      {/* Logo */}
      <div className={cn(
        "flex items-center gap-3 mb-8",
        collapsed ? "px-1 justify-center" : "px-3 justify-start"
      )}>
        <div className="size-[34px] rounded-sm bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shrink-0 shadow-glow-teal">
          <ShieldIcon s={18} />
        </div>
        {!collapsed && (
          <div>
            <div className="text-[17px] font-extrabold tracking-[3px] text-foreground">AEGIS</div>
            <div className="text-tiny text-[var(--color-text-disabled)] tracking-[2px]">v3.0</div>
          </div>
        )}
      </div>

      {/* Main nav */}
      {navItems.map(it => {
        const active = activeTab === it.id;
        return (
          <button
            key={it.id}
            data-testid={`aegis-nav-${it.id}`}
            onClick={() => onTabChange(it.id)}
            className={cn(
              "flex items-center gap-3 mb-1 rounded-sm cursor-pointer transition-all duration-150 w-full font-[inherit] border",
              collapsed ? "py-3 px-0 justify-center" : "py-3 px-4 justify-start",
              active
                ? "bg-blue-600/[0.12] border-blue-600/20 border-l-4 border-l-blue-400 text-blue-400 shadow-[inset_0_0_20px_rgba(37,99,235,0.08)]"
                : "bg-transparent border-transparent border-l-4 border-l-transparent text-[var(--color-text-disabled)] hover:text-[var(--color-text-tertiary)] hover:bg-navy-lighter/50"
            )}
          >
            {it.icon}
            {!collapsed && (
              <div>
                <div className={cn("text-[13px]", active ? "font-bold" : "font-normal")}>{it.label}</div>
                {it.description && (
                  <div className="text-tiny text-[var(--color-text-disabled)] font-normal mt-px leading-[1.2]">{it.description}</div>
                )}
              </div>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      {/* Auth */}
      {!collapsed && (
        <div className="mb-3">
          {isAuthenticated ? <UserBadge /> : <LoginButton />}
        </div>
      )}

      {/* Footer nav */}
      {footerNav.filter(n => !n.authOnly || isAuthenticated).map(n => {
        const active = activeTab === n.id;
        return (
          <button
            key={n.id}
            data-testid={`aegis-nav-${n.id}`}
            onClick={() => onTabChange(n.id)}
            className={cn(
              "flex items-center gap-2 mb-1 rounded-sm cursor-pointer transition-all duration-150 w-full font-[inherit] border",
              collapsed ? "py-2 px-0 justify-center" : "py-2 px-3 justify-start",
              active
                ? "bg-blue-600/[0.12] border-blue-600/20 text-blue-400"
                : "bg-transparent border-transparent text-[var(--color-text-disabled)] hover:text-[var(--color-text-tertiary)]"
            )}
          >
            {n.icon}
            {!collapsed && <span className={cn("text-caption", active ? "font-bold" : "font-medium")}>{n.label}</span>}
          </button>
        );
      })}

      {/* GitHub link */}
      <a
        href="https://github.com/dwebxr/aegis"
        target="_blank"
        rel="noopener noreferrer"
        title="Open Source on GitHub"
        className={cn(
          "flex items-center gap-2 mb-2 text-caption text-[var(--color-text-disabled)] no-underline rounded-sm transition-all duration-150 hover:text-[var(--color-text-tertiary)]",
          collapsed ? "py-2 px-0 justify-center" : "py-2 px-3 justify-start"
        )}
      >
        <GitHubIcon s={14} />
        {!collapsed && (
          <div>
            <div>GitHub</div>
            <div className="text-tiny text-emerald-400 font-semibold tracking-wide">Open Source & Non-Custodial</div>
          </div>
        )}
      </a>

      {/* Status indicator */}
      <div className={cn(
        "bg-emerald-dim border border-emerald-border rounded-md shadow-glow-green",
        collapsed ? "px-1 py-2 text-center" : "px-3 py-2 text-left"
      )}>
        {collapsed ? (
          <div className="flex justify-center">
            <div className="size-[7px] rounded-full bg-emerald-400 animate-pulse" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="size-[7px] rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-caption font-semibold text-emerald-400 uppercase tracking-wider">Online</span>
            <span className="text-tiny text-[var(--color-text-disabled)]">·</span>
            <span className="text-caption font-bold text-secondary-foreground font-mono">Aegis AI</span>
          </div>
        )}
      </div>
    </nav>
  );
};
