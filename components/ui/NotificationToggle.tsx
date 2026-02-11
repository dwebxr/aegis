"use client";
import React from "react";
import { colors, space, type as t, radii, transitions } from "@/styles/theme";
import { useAuth } from "@/contexts/AuthContext";
import { usePushNotification } from "@/hooks/usePushNotification";

export const NotificationToggle: React.FC = () => {
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
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

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
