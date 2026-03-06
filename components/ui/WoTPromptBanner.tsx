"use client";
import React from "react";

interface WoTPromptBannerProps {
  onGoToSettings: () => void;
  onDismiss: () => void;
}

export const WoTPromptBanner: React.FC<WoTPromptBannerProps> = ({ onGoToSettings, onDismiss }) => (
  <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2 bg-gradient-to-br from-emerald-500/[0.08] to-cyan-500/[0.08] border border-emerald-500/20 rounded-md mb-4">
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <span className="text-body-sm text-tertiary leading-snug">
        <strong className="text-emerald-400">Web of Trust</strong>
        {" \u2014 Link your Nostr account to activate trust-based content filtering"}
      </span>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={onGoToSettings}
        className="px-3 py-1 bg-gradient-to-br from-emerald-500 to-cyan-500 border-none rounded-sm text-white text-body-sm font-bold cursor-pointer font-[inherit]"
      >
        Link Account
      </button>
      <button
        onClick={onDismiss}
        className="bg-transparent border-none cursor-pointer text-disabled text-sm p-1 leading-none"
      >
        &#x2715;
      </button>
    </div>
  </div>
);
