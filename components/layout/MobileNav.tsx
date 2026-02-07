"use client";
import React from "react";
import { useAuth } from "@/contexts/AuthContext";
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
      borderTop: "1px solid rgba(255,255,255,0.06)",
      display: "flex", flexDirection: "column",
      paddingBottom: "env(safe-area-inset-bottom, 8px)", zIndex: 50,
    }}>
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", height: 56 }}>
        {navItems.map(it => (
          <button key={it.id} onClick={() => onTabChange(it.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            background: "none", border: "none", cursor: "pointer", padding: "6px 12px",
            color: activeTab === it.id ? "#60a5fa" : "#4a5568", transition: "color .2s",
          }}>
            {it.icon}
            <span style={{ fontSize: 9, fontWeight: activeTab === it.id ? 700 : 500, letterSpacing: 0.5 }}>{it.label}</span>
            {activeTab === it.id && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#60a5fa", marginTop: 1 }} />}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "center", paddingBottom: 4 }}>
        {isAuthenticated ? (
          <button onClick={logout} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 14px", background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.15)", borderRadius: 6,
            color: "#f87171", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}>
            <span style={{ fontSize: 10, color: "#34d399", fontFamily: "'JetBrains Mono', monospace" }}>{short}</span>
            <span>Logout</span>
          </button>
        ) : (
          <button onClick={login} style={{
            padding: "4px 14px", background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
            border: "none", borderRadius: 6, color: "#fff", fontSize: 10,
            fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>
            Login
          </button>
        )}
      </div>
    </nav>
  );
};
