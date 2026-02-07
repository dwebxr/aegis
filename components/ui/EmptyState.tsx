"use client";
import React from "react";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" }}>
    <div style={{ color: "#64748b", marginBottom: 16, opacity: 0.5 }}>{icon}</div>
    <div style={{ fontSize: 16, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>{title}</div>
    <div style={{ fontSize: 13, color: "#64748b", maxWidth: 320, lineHeight: 1.5 }}>{description}</div>
    {action && <div style={{ marginTop: 16 }}>{action}</div>}
  </div>
);
