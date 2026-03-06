"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface UserBadgeProps {
  compact?: boolean;
}

export const UserBadge: React.FC<UserBadgeProps> = ({ compact }) => {
  const { isAuthenticated, principalText, isLoading, logout } = useAuth();

  if (isLoading || !isAuthenticated) return null;

  const short = principalText.length > 12
    ? principalText.slice(0, 5) + "..." + principalText.slice(-5)
    : principalText;

  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn(
        "flex items-center gap-2 bg-green-400/[0.06] border border-green-400/[0.15] rounded-[10px]",
        compact ? "px-2.5 py-1.5" : "px-3.5 py-2"
      )}>
        <div className="size-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
        <div className="overflow-hidden flex-1">
          <div className={cn(
            "font-semibold text-secondary-foreground font-mono whitespace-nowrap overflow-hidden text-ellipsis",
            compact ? "text-caption" : "text-kpi-sub"
          )}>
            {short}
          </div>
          <div className="text-tiny text-muted-foreground font-medium">
            Connected
          </div>
        </div>
      </div>
      <button
        onClick={logout}
        className={cn(
          "bg-red-400/[0.08] border border-red-400/15 rounded-lg text-red-400 font-semibold cursor-pointer font-[inherit] w-full",
          compact ? "px-2.5 py-1 text-caption" : "px-3.5 py-1.5 text-kpi-sub"
        )}
      >
        Logout
      </button>
    </div>
  );
};
