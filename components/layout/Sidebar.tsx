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
