"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { ShieldIcon, GearIcon, ChartIcon, GitHubIcon, SocialIcon } from "@/components/icons";
import { SOCIAL_LINKS } from "@/lib/config";
import { LoginButton } from "@/components/auth/LoginButton";
import { UserBadge } from "@/components/auth/UserBadge";
import { useAuth } from "@/contexts/AuthContext";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

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
  { id: "settings", icon: <GearIcon s={16} />, label: "Settings", tooltip: "Preferences and account", authOnly: true },
  { id: "analytics", icon: <ChartIcon s={16} />, label: "Stats", tooltip: "Performance metrics", authOnly: false },
];

export const Sidebar: React.FC<SidebarProps> = ({ navItems, activeTab, onTabChange, collapsed }) => {
  const { isAuthenticated } = useAuth();
  return (
    <nav
      className={cn(
        "flex flex-col shrink-0 bg-overlay backdrop-blur-lg border-r border-subtle transition-[width] duration-300",
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
            <div className="text-tiny text-disabled tracking-[2px]">v3.0</div>
          </div>
        )}
      </div>

      {/* Main nav */}
      {navItems.map(it => {
        const active = activeTab === it.id;
        const btn = (
          <button
            data-testid={`aegis-nav-${it.id}`}
            onClick={() => onTabChange(it.id)}
            aria-label={it.label}
            className={cn(
              "flex items-center gap-3 mb-1 rounded-sm cursor-pointer transition-all duration-150 w-full font-[inherit] border",
              collapsed ? "py-3 px-0 justify-center" : "py-3 px-4 justify-start",
              active
                ? "bg-blue-600/[0.12] border-blue-600/20 border-l-4 border-l-blue-400 text-blue-400 shadow-[inset_0_0_20px_rgba(37,99,235,0.08)]"
                : "bg-transparent border-transparent border-l-4 border-l-transparent text-disabled hover:text-tertiary hover:bg-navy-lighter/50"
            )}
          >
            {it.icon}
            {!collapsed && (
              <div>
                <div className={cn("text-[13px]", active ? "font-bold" : "font-normal")}>{it.label}</div>
              </div>
            )}
          </button>
        );

        if (collapsed) {
          return (
            <Tooltip key={it.id}>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent side="right">
                <div className="font-semibold">{it.label}</div>
                {it.description && <div className="text-xs opacity-70">{it.description}</div>}
              </TooltipContent>
            </Tooltip>
          );
        }

        return <React.Fragment key={it.id}>{btn}</React.Fragment>;
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
        const btn = (
          <button
            data-testid={`aegis-nav-${n.id}`}
            onClick={() => onTabChange(n.id)}
            aria-label={n.label}
            className={cn(
              "flex items-center gap-2 mb-1 rounded-sm cursor-pointer transition-all duration-150 w-full font-[inherit] border",
              collapsed ? "py-2 px-0 justify-center" : "py-2 px-3 justify-start",
              active
                ? "bg-blue-600/[0.12] border-blue-600/20 text-blue-400"
                : "bg-transparent border-transparent text-disabled hover:text-tertiary"
            )}
          >
            {n.icon}
            {!collapsed && <span className={cn("text-caption", active ? "font-bold" : "font-medium")}>{n.label}</span>}
          </button>
        );

        if (collapsed) {
          return (
            <Tooltip key={n.id}>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent side="right">{n.tooltip}</TooltipContent>
            </Tooltip>
          );
        }

        return <React.Fragment key={n.id}>{btn}</React.Fragment>;
      })}

      {/* GitHub link */}
      <a
        href="https://github.com/dwebxr/aegis"
        target="_blank"
        rel="noopener noreferrer"
        title="Open Source on GitHub"
        className={cn(
          "flex items-center gap-2 mb-2 text-caption text-disabled no-underline rounded-sm transition-all duration-150 hover:text-tertiary",
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

      {/* Social links */}
      <div className={cn(
        "flex items-center gap-1 mb-2",
        collapsed ? "justify-center" : "px-3"
      )}>
        {SOCIAL_LINKS.map(link => (
          <a
            key={link.key}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            title={link.title}
            className="flex items-center justify-center size-7 rounded-sm text-disabled hover:text-tertiary transition-all duration-150"
          >
            <SocialIcon name={link.key} s={14} />
          </a>
        ))}
      </div>

      {/* Status indicator */}
      <div className={cn(
        "bg-emerald-dim border border-emerald-border rounded-md shadow-glow-green",
        collapsed ? "px-1 py-2 text-center" : "px-3 py-2 text-left"
      )}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex justify-center">
                <div className="size-[7px] rounded-full bg-emerald-400 animate-pulse" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">Online — Aegis AI</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-2">
            <div className="size-[7px] rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-caption font-semibold text-emerald-400 uppercase tracking-wider">Online</span>
            <span className="text-tiny text-disabled">&middot;</span>
            <span className="text-caption font-bold text-secondary-foreground font-mono">Aegis AI</span>
          </div>
        )}
      </div>
    </nav>
  );
};
