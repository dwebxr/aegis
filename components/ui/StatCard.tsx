"use client";
import React from "react";
import { fonts } from "@/styles/theme";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  mobile?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({ icon, label, value, sub, color, mobile }) => (
  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 14, padding: mobile ? "14px 14px" : "18px 20px", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: -8, right: -8, width: 48, height: 48, borderRadius: "50%", background: `${color}08` }} />
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ color, opacity: 0.8 }}>{icon}</div>
      <span style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>{label}</span>
    </div>
    <div style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#e2e8f0", fontFamily: fonts.mono }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color, marginTop: 2, fontWeight: 500 }}>{sub}</div>}
  </div>
);
