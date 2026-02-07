"use client";
import React from "react";
import { fonts } from "@/styles/theme";
import { ShieldIcon } from "@/components/icons";
import { LoginButton } from "@/components/auth/LoginButton";
import { UserBadge } from "@/components/auth/UserBadge";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
import { useAuth } from "@/contexts/AuthContext";

export interface NavItem {
  id: string;
  icon: React.ReactNode;
  label: string;
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
    background: "rgba(15,23,42,0.8)",
    borderRight: "1px solid rgba(255,255,255,0.05)",
    padding: collapsed ? "20px 8px" : "24px 12px",
    display: "flex",
    flexDirection: "column",
    backdropFilter: "blur(20px)",
    flexShrink: 0,
    transition: "width .3s",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: collapsed ? "0 4px" : "0 12px", marginBottom: 32, justifyContent: collapsed ? "center" : "flex-start" }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <ShieldIcon s={18} />
      </div>
      {!collapsed && (
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 3 }}>AEGIS</div>
          <div style={{ fontSize: 8, color: "#64748b", letterSpacing: 2 }}>v3.0</div>
        </div>
      )}
    </div>

    {navItems.map(it => (
      <button key={it.id} onClick={() => onTabChange(it.id)} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: collapsed ? "10px 0" : "10px 14px",
        marginBottom: 3,
        background: activeTab === it.id ? "rgba(37,99,235,0.12)" : "transparent",
        border: activeTab === it.id ? "1px solid rgba(37,99,235,0.2)" : "1px solid transparent",
        borderRadius: 11, cursor: "pointer", transition: "all .2s", width: "100%",
        color: activeTab === it.id ? "#60a5fa" : "#64748b",
        justifyContent: collapsed ? "center" : "flex-start",
      }}>
        {it.icon}
        {!collapsed && <span style={{ fontSize: 13, fontWeight: activeTab === it.id ? 600 : 400 }}>{it.label}</span>}
      </button>
    ))}

    <div style={{ flex: 1 }} />

    {!collapsed && (
      <div style={{ marginBottom: 10 }}>
        {isAuthenticated ? <UserBadge /> : <LoginButton />}
      </div>
    )}

    {!collapsed && isAuthenticated && (
      <div style={{ marginBottom: 10 }}>
        <AgentStatusBadge compact />
      </div>
    )}

    <div style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.1)", borderRadius: 12, padding: collapsed ? "10px 6px" : "12px 14px", textAlign: collapsed ? "center" : "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, justifyContent: collapsed ? "center" : "flex-start" }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399", animation: "pulse 2s infinite" }} />
        {!collapsed && <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>Online</span>}
      </div>
      <div style={{ fontSize: collapsed ? 11 : 13, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.mono }}>Aegis AI</div>
      {!collapsed && <div style={{ fontSize: 9, color: "#64748b" }}>Content Filter</div>}
    </div>
  </nav>
  );
};
