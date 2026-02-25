"use client";
import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { GearIcon, ChartIcon, GitHubIcon } from "@/components/icons";

const footerButtons = [
  { id: "settings", icon: <GearIcon s={14} />, title: "Settings" },
  { id: "analytics", icon: <ChartIcon s={14} />, title: "Stats" },
];
import { colors, space, type as t, radii, transitions, fonts, shadows } from "@/styles/theme";
import type { NavItem } from "./Sidebar";

interface MobileNavProps {
  navItems: NavItem[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ navItems, activeTab, onTabChange }) => {
  const { isAuthenticated, principalText, login, logout } = useAuth();
  const short = principalText.length > 8
    ? principalText.slice(0, 4) + ".." + principalText.slice(-3)
    : principalText;

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "rgba(10,15,30,0.95)", backdropFilter: "blur(20px)",
      borderTop: `1px solid ${colors.border.subtle}`,
      display: "flex", flexDirection: "column",
      paddingBottom: "env(safe-area-inset-bottom, 8px)", zIndex: 50,
    }}>
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", height: 56 }}>
        {navItems.map(it => {
          const active = activeTab === it.id;
          return (
            <button key={it.id} data-testid={`aegis-nav-mobile-${it.id}`} onClick={() => onTabChange(it.id)} title={it.description} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: "none", border: "none", cursor: "pointer",
              padding: `6px ${space[3]}px`, minHeight: 48, minWidth: 48,
              color: active ? colors.blue[400] : colors.text.disabled, transition: transitions.fast,
              fontFamily: "inherit", justifyContent: "center",
            }}>
              {it.icon}
              <span style={{ fontSize: t.caption.size, fontWeight: active ? 700 : 500, letterSpacing: 0.5 }}>{it.label}</span>
              {active && <div style={{ width: 16, height: 2, borderRadius: 1, background: colors.blue[400], marginTop: 1 }} />}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: space[2], paddingBottom: space[1], flexWrap: "wrap", padding: `0 ${space[3]}px ${space[1]}px` }}>
        {isAuthenticated ? (
          <>
            <button onClick={logout} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: `${space[1]}px ${space[4]}px`, background: colors.red.bg,
              border: `1px solid ${colors.red.border}`, borderRadius: radii.sm,
              color: colors.red[400], fontSize: t.caption.size, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>
              <span style={{ fontSize: t.caption.size, color: colors.green[400], fontFamily: fonts.mono }}>{short}</span>
              <span>Logout</span>
            </button>
            {footerButtons.map(btn => {
              const active = activeTab === btn.id;
              return (
                <button key={btn.id} onClick={() => onTabChange(btn.id)} title={btn.title} style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, padding: 0,
                  background: active ? "rgba(37,99,235,0.12)" : "transparent",
                  border: `1px solid ${active ? "rgba(37,99,235,0.2)" : colors.border.subtle}`,
                  borderRadius: radii.sm, cursor: "pointer",
                  color: active ? colors.blue[400] : colors.text.disabled,
                  transition: transitions.fast,
                }}>
                  {btn.icon}
                </button>
              );
            })}
          </>
        ) : (
          <button onClick={login} style={{
            padding: `${space[2]}px ${space[6]}px`,
            background: `linear-gradient(135deg, ${colors.blue[600]}, ${colors.cyan[500]})`,
            border: "none", borderRadius: radii.sm, color: "#fff", fontSize: t.body.mobileSz,
            fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            boxShadow: shadows.glow.cyan,
          }}>
            Login with Internet Identity
          </button>
        )}
        <a
          href="https://github.com/dwebxr/aegis"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: `${space[1]}px ${space[3]}px`,
            fontSize: t.caption.size, color: colors.text.disabled, textDecoration: "none",
            borderRadius: radii.sm,
          }}
        >
          <GitHubIcon s={12} />
          <span style={{ color: colors.green[400], fontWeight: 600, letterSpacing: 0.5 }}>OSS</span>
        </a>
      </div>
    </nav>
  );
};
