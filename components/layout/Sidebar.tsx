"use client";
import React from "react";
import { fonts, colors, space, type as t, radii, transitions, shadows } from "@/styles/theme";
import { ShieldIcon } from "@/components/icons";
import { LoginButton } from "@/components/auth/LoginButton";
import { UserBadge } from "@/components/auth/UserBadge";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
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

export const Sidebar: React.FC<SidebarProps> = ({ navItems, activeTab, onTabChange, collapsed }) => {
  const { isAuthenticated } = useAuth();
  return (
  <nav style={{
    width: collapsed ? 68 : 200,
    background: colors.bg.overlay,
    borderRight: `1px solid ${colors.border.subtle}`,
    padding: collapsed ? `${space[5]}px ${space[2]}px` : `${space[6]}px ${space[3]}px`,
    display: "flex",
    flexDirection: "column",
    backdropFilter: "blur(20px)",
    flexShrink: 0,
    transition: "width .3s",
  }}>
    <div style={{
      display: "flex", alignItems: "center", gap: space[3],
      padding: collapsed ? `0 ${space[1]}px` : `0 ${space[3]}px`,
      marginBottom: space[8],
      justifyContent: collapsed ? "center" : "flex-start",
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: radii.sm,
        background: `linear-gradient(135deg,${colors.cyan[500]},${colors.blue[600]})`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        boxShadow: shadows.glow.cyan,
      }}>
        <ShieldIcon s={18} />
      </div>
      {!collapsed && (
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 3, color: colors.text.primary }}>AEGIS</div>
          <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, letterSpacing: 2 }}>v3.0</div>
        </div>
      )}
    </div>

    {navItems.map(it => {
      const active = activeTab === it.id;
      return (
        <button key={it.id} onClick={() => onTabChange(it.id)} style={{
          display: "flex", alignItems: "center", gap: space[3],
          padding: collapsed ? `${space[3]}px 0` : `${space[3]}px ${space[4]}px`,
          marginBottom: space[1],
          background: active ? "rgba(37,99,235,0.12)" : "transparent",
          border: active ? `1px solid rgba(37,99,235,0.2)` : "1px solid transparent",
          borderLeft: active ? `3px solid ${colors.blue[400]}` : "3px solid transparent",
          borderRadius: radii.sm, cursor: "pointer", transition: transitions.fast, width: "100%",
          color: active ? colors.blue[400] : colors.text.disabled,
          justifyContent: collapsed ? "center" : "flex-start",
          fontFamily: "inherit",
          boxShadow: active ? "inset 0 0 12px rgba(37,99,235,0.06)" : "none",
        }}>
          {it.icon}
          {!collapsed && (
            <div>
              <div style={{ fontSize: t.body.mobileSz, fontWeight: active ? 700 : 400 }}>{it.label}</div>
              {it.description && (
                <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, fontWeight: 400, marginTop: 1, lineHeight: t.tiny.lineHeight }}>{it.description}</div>
              )}
            </div>
          )}
        </button>
      );
    })}

    <div style={{ flex: 1 }} />

    {!collapsed && (
      <div style={{ marginBottom: space[3] }}>
        {isAuthenticated ? <UserBadge /> : <LoginButton />}
      </div>
    )}

    {!collapsed && isAuthenticated && (
      <div style={{ marginBottom: space[3] }}>
        <AgentStatusBadge compact />
      </div>
    )}

    <a
      href="https://github.com/dwebxr/aegis"
      target="_blank"
      rel="noopener noreferrer"
      title="Open Source on GitHub"
      style={{
        display: "flex", alignItems: "center", gap: space[2],
        padding: collapsed ? `${space[2]}px 0` : `${space[2]}px ${space[3]}px`,
        marginBottom: space[2],
        fontSize: t.caption.size, color: colors.text.disabled, textDecoration: "none",
        borderRadius: radii.sm, transition: transitions.fast,
        justifyContent: collapsed ? "center" : "flex-start",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      {!collapsed && (
        <div>
          <div>GitHub</div>
          <div style={{ fontSize: t.tiny.size, color: colors.green[400], fontWeight: 600, letterSpacing: 0.5 }}>Open Source & Non-Custodial</div>
        </div>
      )}
    </a>

    <div style={{
      background: colors.green.bg, border: `1px solid ${colors.green.border}`,
      borderRadius: radii.md, padding: collapsed ? `${space[2]}px ${space[1]}px` : `${space[2]}px ${space[3]}px`,
      textAlign: collapsed ? "center" : "left",
      boxShadow: shadows.glow.green,
    }}>
      {collapsed ? (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: colors.green[400], animation: "pulse 2s infinite" }} />
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: colors.green[400], animation: "pulse 2s infinite", flexShrink: 0 }} />
          <span style={{ fontSize: t.caption.size, fontWeight: 600, color: colors.green[400], textTransform: "uppercase", letterSpacing: 1.5 }}>Online</span>
          <span style={{ fontSize: t.tiny.size, color: colors.text.disabled }}>·</span>
          <span style={{ fontSize: t.caption.size, fontWeight: 700, color: colors.text.secondary, fontFamily: fonts.mono }}>Aegis AI</span>
        </div>
      )}
    </div>
  </nav>
  );
};
