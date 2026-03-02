"use client";
import React from "react";
import { colors, space, type as t, radii, transitions } from "@/styles/theme";
import { useAuth } from "@/contexts/AuthContext";
import { usePushNotification } from "@/hooks/usePushNotification";

interface NotificationToggleProps {
  compact?: boolean;
}

export const NotificationToggle: React.FC<NotificationToggleProps> = ({ compact }) => {
  const { isAuthenticated } = useAuth();
  const {
    isSupported,
    permission,
    isSubscribed,
    subscribe,
    unsubscribe,
    isLoading,
  } = usePushNotification();

  if (!isAuthenticated || !isSupported) return null;

  const denied = permission === "denied";

  const handleToggle = async () => {
    try {
      if (isSubscribed) {
        await unsubscribe();
      } else {
        await subscribe();
      }
    } catch (err) {
      console.error("[NotificationToggle] Toggle failed:", err instanceof Error ? err.message : String(err));
    }
  };

  if (compact) {
    const bellColor = isSubscribed ? colors.cyan[400] : denied ? colors.red[400] : colors.text.disabled;
    return (
      <button
        onClick={handleToggle}
        disabled={denied || isLoading}
        title={isSubscribed ? "Push notifications on" : denied ? "Notifications blocked" : "Enable push notifications"}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 28,
          background: isSubscribed ? `${colors.cyan[500]}18` : "transparent",
          border: `1px solid ${isSubscribed ? `${colors.cyan[500]}33` : colors.border.subtle}`,
          borderRadius: radii.sm,
          cursor: denied || isLoading ? "not-allowed" : "pointer",
          opacity: denied || isLoading ? 0.4 : 1,
          transition: transitions.fast,
          padding: 0, flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={bellColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          {isSubscribed && <circle cx="18" cy="4" r="3" fill={colors.cyan[400]} stroke="none" />}
        </svg>
      </button>
    );
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: `${space[2]}px ${space[3]}px`,
      background: isSubscribed ? `${colors.cyan[500]}0A` : colors.bg.surface,
      border: `1px solid ${isSubscribed ? `${colors.cyan[500]}33` : colors.border.subtle}`,
      borderRadius: radii.md,
      transition: transitions.fast,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: t.caption.size,
          fontWeight: 600,
          color: isSubscribed ? colors.cyan[400] : colors.text.muted,
          letterSpacing: 0.3,
        }}>
          Push Notifications
        </div>
        <div style={{
          fontSize: t.tiny.size,
          color: colors.text.disabled,
          marginTop: 1,
          lineHeight: t.tiny.lineHeight,
        }}>
          {isSubscribed
            ? "Briefing alerts active"
            : denied
              ? "Blocked in browser"
              : "Get briefing alerts"}
        </div>
      </div>
      <button
        onClick={handleToggle}
        disabled={denied || isLoading}
        style={{
          padding: `${space[1]}px ${space[3]}px`,
          borderRadius: radii.sm,
          fontSize: t.caption.size,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: denied || isLoading ? "not-allowed" : "pointer",
          opacity: denied || isLoading ? 0.4 : 1,
          background: isSubscribed ? "transparent" : `${colors.cyan[500]}18`,
          color: isSubscribed ? colors.text.muted : colors.cyan[400],
          border: `1px solid ${isSubscribed ? colors.border.subtle : `${colors.cyan[500]}33`}`,
          transition: transitions.fast,
          flexShrink: 0,
        }}
      >
        {isLoading ? "..." : isSubscribed ? "Off" : "On"}
      </button>
    </div>
  );
};
