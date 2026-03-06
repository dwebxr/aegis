"use client";
import React from "react";
import { useDemo } from "@/contexts/DemoContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

export const DemoBanner: React.FC<{ mobile?: boolean }> = ({ mobile }) => {
  const { isDemoMode, bannerDismissed, dismissBanner } = useDemo();
  const { login } = useAuth();

  if (!isDemoMode || bannerDismissed) return null;

  return (
    <div
      data-testid="aegis-demo-banner"
      className="flex items-center justify-between flex-wrap gap-2 px-4 py-2 mb-4 rounded-md bg-gradient-to-br from-blue-600/[0.08] to-cyan-500/[0.08] border border-blue-600/20"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-sm shrink-0">&#x1F6E1;&#xFE0F;</span>
        <span className={cn(
          "leading-[1.4] text-[var(--color-text-tertiary)]",
          mobile ? "text-caption" : "text-body-sm"
        )}>
          <strong className="text-blue-400">Demo Mode</strong>
          {" \u2014 "}
          {mobile
            ? "Preset feeds active. Login for full access."
            : "Exploring with preset feeds. Login to save sources & access all features."}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={login}
          className="px-3 py-1 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-sm text-white text-body-sm font-bold cursor-pointer border-none"
        >
          Login
        </button>
        <button
          data-testid="aegis-demo-banner-dismiss"
          onClick={dismissBanner}
          className="bg-none border-none cursor-pointer text-[var(--color-text-disabled)] text-sm p-1 leading-none"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
};
