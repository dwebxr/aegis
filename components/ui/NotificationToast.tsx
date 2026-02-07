"use client";
import React from "react";
import type { Notification } from "@/hooks/useNotifications";

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  success: { bg: "rgba(52,211,153,0.15)", border: "rgba(52,211,153,0.3)", text: "#34d399" },
  error:   { bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.3)", text: "#f87171" },
  info:    { bg: "rgba(56,189,248,0.15)", border: "rgba(56,189,248,0.3)", text: "#38bdf8" },
};

interface NotificationToastProps {
  notifications: Notification[];
  mobile?: boolean;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ notifications, mobile }) => (
  <div style={{ position: "fixed", bottom: mobile ? 84 : 20, right: mobile ? 14 : 20, display: "flex", flexDirection: "column", gap: 6, zIndex: 100 }}>
    {notifications.map(n => {
      const c = COLORS[n.type] || COLORS.info;
      return (
        <div key={n.id} style={{
          padding: "10px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600, animation: "fadeIn .3s ease",
          background: c.bg, border: `1px solid ${c.border}`, color: c.text, backdropFilter: "blur(12px)",
        }}>
          {n.text}
        </div>
      );
    })}
  </div>
);
