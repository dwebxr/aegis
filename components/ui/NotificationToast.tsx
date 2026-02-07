"use client";
import React from "react";
import type { Notification } from "@/hooks/useNotifications";

interface NotificationToastProps {
  notifications: Notification[];
  mobile?: boolean;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ notifications, mobile }) => (
  <div style={{ position: "fixed", bottom: mobile ? 84 : 20, right: mobile ? 14 : 20, display: "flex", flexDirection: "column", gap: 6, zIndex: 100 }}>
    {notifications.map(n => (
      <div key={n.id} style={{
        padding: "10px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600, animation: "fadeIn .3s ease",
        background: n.type === "success" ? "rgba(52,211,153,0.15)" : n.type === "error" ? "rgba(248,113,113,0.15)" : "rgba(56,189,248,0.15)",
        border: `1px solid ${n.type === "success" ? "rgba(52,211,153,0.3)" : n.type === "error" ? "rgba(248,113,113,0.3)" : "rgba(56,189,248,0.3)"}`,
        color: n.type === "success" ? "#34d399" : n.type === "error" ? "#f87171" : "#38bdf8",
        backdropFilter: "blur(12px)",
      }}>
        {n.text}
      </div>
    ))}
  </div>
);
