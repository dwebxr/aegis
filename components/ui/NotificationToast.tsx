"use client";
import React from "react";
import { colors, space, radii, shadows, type as t } from "@/styles/theme";
import type { Notification } from "@/hooks/useNotifications";

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  success: { bg: "rgba(52,211,153,0.15)", border: colors.green.border, text: colors.green[400] },
  error:   { bg: "rgba(248,113,113,0.15)", border: colors.red.border, text: colors.red[400] },
  info:    { bg: "rgba(56,189,248,0.15)", border: "rgba(56,189,248,0.3)", text: colors.sky[400] },
};

interface NotificationToastProps {
  notifications: Notification[];
  mobile?: boolean;
  onDismiss?: (id: number) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ notifications, mobile, onDismiss }) => (
  <div style={{ position: "fixed", bottom: mobile ? 84 : space[5], right: mobile ? space[4] : space[5], display: "flex", flexDirection: "column", gap: 6, zIndex: 100 }}>
    {notifications.map(n => {
      const c = COLORS[n.type] || COLORS.info;
      return (
        <div key={n.id} role="alert" style={{
          padding: `${space[3]}px ${space[4]}px`, borderRadius: radii.md,
          fontSize: t.bodySm.size, fontWeight: 600, animation: "fadeIn .3s ease",
          background: c.bg, border: `1px solid ${c.border}`, color: c.text,
          backdropFilter: "blur(12px)", boxShadow: shadows.md,
          display: "flex", alignItems: "center", gap: space[2],
        }}>
          <span style={{ flex: 1 }}>{n.text}</span>
          {onDismiss && (
            <button
              onClick={() => onDismiss(n.id)}
              aria-label="Dismiss notification"
              style={{
                background: "none", border: "none", color: c.text,
                cursor: "pointer", fontSize: "1rem", fontWeight: 700,
                padding: "0 2px", opacity: 0.7, fontFamily: "inherit",
                lineHeight: 1,
              }}
            >
              &times;
            </button>
          )}
        </div>
      );
    })}
  </div>
);
