"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { GearIcon, ChartIcon, GitHubIcon, SocialIcon } from "@/components/icons";
import { SOCIAL_LINKS } from "@/lib/config";
import type { NavItem } from "./Sidebar";

const footerButtons = [
  { id: "settings", icon: <GearIcon s={14} />, title: "Settings" },
  { id: "analytics", icon: <ChartIcon s={14} />, title: "Stats" },
];

interface MobileNavProps {
  navItems: NavItem[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ navItems, activeTab, onTabChange }) => {
  const { isAuthenticated, login } = useAuth();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-navy/95 backdrop-blur-lg border-t border-subtle flex flex-col pb-[env(safe-area-inset-bottom,8px)] z-50">
      {/* Primary nav row */}
      <div className="flex justify-around items-center h-14">
        {navItems.map(it => {
          const active = activeTab === it.id;
          return (
            <button
              key={it.id}
              data-testid={`aegis-nav-mobile-${it.id}`}
              onClick={() => onTabChange(it.id)}
              title={it.description}
              className={cn(
                "flex flex-col items-center justify-center gap-[3px] bg-none border-none cursor-pointer px-3 py-1.5 min-h-12 min-w-12 font-[inherit] transition-all duration-150",
                active ? "text-blue-400" : "text-disabled"
              )}
            >
              {it.icon}
              <span className={cn("text-caption tracking-wide", active ? "font-bold" : "font-medium")}>{it.label}</span>
              {active && <div className="w-4 h-0.5 rounded-sm bg-blue-400 mt-px" />}
            </button>
          );
        })}
      </div>

      {/* Footer row */}
      <div className="flex justify-center items-center gap-2 flex-wrap px-3 pb-1">
        {isAuthenticated ? (
          <>
            {footerButtons.map(btn => {
              const active = activeTab === btn.id;
              return (
                <button
                  key={btn.id}
                  data-testid={`aegis-nav-mobile-${btn.id}`}
                  onClick={() => onTabChange(btn.id)}
                  title={btn.title}
                  className={cn(
                    "flex items-center justify-center size-7 p-0 rounded-sm cursor-pointer transition-all duration-150 border",
                    active
                      ? "bg-blue-600/[0.12] border-blue-600/20 text-blue-400"
                      : "bg-transparent border-subtle text-disabled"
                  )}
                >
                  {btn.icon}
                </button>
              );
            })}
            {SOCIAL_LINKS.map(link => (
              <a
                key={link.key}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                title={link.title}
                className="flex items-center justify-center size-7 rounded-sm text-disabled hover:text-tertiary transition-all duration-150"
              >
                <SocialIcon name={link.key} s={12} />
              </a>
            ))}
            <a
              href="https://github.com/dwebxr/aegis"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1 text-caption text-disabled no-underline rounded-sm"
            >
              <GitHubIcon s={12} />
              <span className="text-emerald-400 font-semibold tracking-wide">OSS</span>
            </a>
          </>
        ) : (
          <button
            onClick={login}
            className="px-6 py-2 bg-gradient-to-br from-blue-600 to-cyan-500 border-none rounded-sm text-white text-[13px] font-bold cursor-pointer font-[inherit] shadow-glow-teal"
          >
            Login with Internet Identity
          </button>
        )}
      </div>
    </nav>
  );
};
