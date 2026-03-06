"use client";
import React from "react";
import { cn } from "@/lib/utils";
import type { Notification } from "@/hooks/useNotifications";

const TOAST_STYLES: Record<string, string> = {
  success: "bg-emerald-400/15 border-emerald-border text-emerald-400",
  error:   "bg-red-400/15 border-red-border text-red-400",
  info:    "bg-sky-400/15 border-sky-400/30 text-sky-400",
};

interface NotificationToastProps {
  notifications: Notification[];
  mobile?: boolean;
  onDismiss?: (id: number) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ notifications, mobile, onDismiss }) => (
  <div className={cn(
    "fixed flex flex-col gap-1.5 z-[100]",
    mobile ? "bottom-[84px] right-4" : "bottom-5 right-5"
  )}>
    {notifications.map(n => (
      <div
        key={n.id}
        role="alert"
        className={cn(
          "px-4 py-3 rounded-md text-body-sm font-semibold animate-fade-in backdrop-blur-sm shadow-md border flex items-center gap-2",
          TOAST_STYLES[n.type] || TOAST_STYLES.info
        )}
      >
        <span className="flex-1">{n.text}</span>
        {onDismiss && (
          <button
            onClick={() => onDismiss(n.id)}
            aria-label="Dismiss notification"
            className="bg-none border-none text-inherit cursor-pointer text-base font-bold px-0.5 opacity-70 font-[inherit] leading-none"
          >
            &times;
          </button>
        )}
      </div>
    ))}
  </div>
);
