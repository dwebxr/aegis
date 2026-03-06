"use client";
import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import { ShieldIcon } from "@/components/icons";
import { errMsg } from "@/lib/utils/errors";

interface LoginButtonProps {
  compact?: boolean;
}

export const LoginButton: React.FC<LoginButtonProps> = ({ compact }) => {
  const { isAuthenticated, isLoading, login, logout } = useAuth();
  const { addNotification } = useNotify();
  const [hovered, setHovered] = useState(false);

  const handleLogin = useCallback(() => {
    login().catch(err => {
      console.error("[auth] Login failed:", errMsg(err));
      addNotification("Login failed. Please try again.", "error");
    });
  }, [login, addNotification]);

  const handleLogout = useCallback(() => {
    logout().catch(err => {
      console.error("[auth] Logout failed:", errMsg(err));
      addNotification("Logout failed. Please try again.", "error");
    });
  }, [logout, addNotification]);

  if (isLoading) {
    return (
      <div className={cn("text-body-sm text-muted-foreground", compact ? "px-3 py-1.5" : "px-[18px] py-3")}>
        <span className="inline-block animate-spin">&#x27F3;</span>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <button
        onClick={handleLogout}
        className={cn(
          "bg-red-400/[0.06] border border-red-400/[0.15] rounded-sm text-red-400 font-semibold cursor-pointer font-[inherit] transition-fast",
          compact ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-body-sm"
        )}
      >
        Logout
      </button>
    );
  }

  return (
    <button
      onClick={handleLogin}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "bg-gradient-to-br from-blue-600 to-cyan-500 border-none rounded-md text-white font-bold cursor-pointer font-[inherit] flex items-center gap-1.5 transition-fast",
        compact ? "px-3 py-1.5 text-[11px]" : "px-[18px] py-3 text-[13px]"
      )}
      style={{
        boxShadow: hovered ? "0 0 20px rgba(6,182,212,0.4)" : "none",
        transform: hovered ? "scale(1.02)" : "scale(1)",
      }}
    >
      <ShieldIcon s={compact ? 13 : 16} />
      {compact ? "Login" : "Login with Internet Identity"}
    </button>
  );
};
