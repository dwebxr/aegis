"use client";
import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { GearIcon } from "@/components/icons";
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
            <button key={it.id} onClick={() => onTabChange(it.id)} title={it.description} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: "none", border: "none", cursor: "pointer", padding: `6px ${space[3]}px`,
              color: active ? colors.blue[400] : colors.text.disabled, transition: transitions.fast,
              fontFamily: "inherit",
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
            <button onClick={() => onTabChange("settings")} title="Settings" style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, padding: 0,
              background: "transparent", border: `1px solid ${colors.border.subtle}`,
              borderRadius: radii.sm, cursor: "pointer", color: colors.text.disabled,
              transition: transitions.fast,
            }}>
              <GearIcon s={14} />
            </button>
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
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          <span style={{ color: colors.green[400], fontWeight: 600, letterSpacing: 0.5 }}>OSS</span>
        </a>
      </div>
    </nav>
  );
};
