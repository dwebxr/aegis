"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { colors } from "@/styles/theme";
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

  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated || !isSupported) return null;

  const denied = permission === "denied";

  const handleToggle = async () => {
    setError(null);
    try {
      if (isSubscribed) {
        await unsubscribe();
      } else {
        await subscribe();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (compact) {
    const bellColor = error ? colors.red[400] : isSubscribed ? colors.cyan[400] : denied ? colors.red[400] : colors.text.disabled;
    return (
      <button
        onClick={handleToggle}
        disabled={denied || isLoading}
        title={error ? `Error: ${error}` : isSubscribed ? "Push notifications on" : denied ? "Notifications blocked" : "Enable push notifications"}
        className={cn(
          "flex items-center justify-center size-7 rounded-sm p-0 shrink-0 transition-fast",
          isSubscribed
            ? "bg-cyan-500/[0.09] border border-cyan-500/20"
            : "bg-transparent border border-[var(--color-border-subtle)]",
          (denied || isLoading) && "opacity-40 cursor-not-allowed",
          !(denied || isLoading) && "cursor-pointer"
        )}
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
    <div className={cn(
      "flex items-center justify-between px-3 py-2 rounded-md transition-fast",
      isSubscribed
        ? "bg-cyan-500/[0.04] border border-cyan-500/20"
        : "bg-card border border-[var(--color-border-subtle)]"
    )}>
      <div className="min-w-0">
        <div className={cn("text-caption font-semibold tracking-[0.3px]", isSubscribed ? "text-cyan-400" : "text-muted-foreground")}>
          Push Notifications
        </div>
        <div className={cn("text-tiny mt-px leading-tight", error ? "text-red-400" : "text-[var(--color-text-disabled)]")}>
          {error
            ? error
            : isSubscribed
              ? "Briefing alerts active"
              : denied
                ? "Blocked in browser"
                : "Get briefing alerts"}
        </div>
      </div>
      <button
        onClick={handleToggle}
        disabled={denied || isLoading}
        className={cn(
          "px-3 py-1 rounded-sm text-caption font-semibold font-[inherit] transition-fast shrink-0",
          (denied || isLoading) && "opacity-40 cursor-not-allowed",
          !(denied || isLoading) && "cursor-pointer",
          isSubscribed
            ? "bg-transparent text-muted-foreground border border-[var(--color-border-subtle)]"
            : "bg-cyan-500/[0.09] text-cyan-400 border border-cyan-500/20"
        )}
      >
        {isLoading ? "..." : isSubscribed ? "Off" : "On"}
      </button>
    </div>
  );
};
