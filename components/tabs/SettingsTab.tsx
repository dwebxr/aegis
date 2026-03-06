"use client";
import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";
import type { ContentItem } from "@/lib/types/content";
import { GeneralSection } from "@/components/settings/GeneralSection";
import { AgentSection } from "@/components/settings/AgentSection";
import { FeedSection } from "@/components/settings/FeedSection";
import { DataSection } from "@/components/settings/DataSection";
import { AccountSection } from "@/components/settings/AccountSection";

export type SettingsSubTab = "general" | "agent" | "feeds" | "data" | "account";

const SUB_TABS: { id: SettingsSubTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "agent", label: "Agent" },
  { id: "feeds", label: "Feeds" },
  { id: "data", label: "Data" },
  { id: "account", label: "Account" },
];

interface SettingsTabProps {
  mobile?: boolean;
  linkedAccount?: LinkedNostrAccount | null;
  onLinkChange?: (account: LinkedNostrAccount | null) => void;
  initialSubTab?: string;
  content?: ContentItem[];
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  mobile, linkedAccount, onLinkChange, initialSubTab, content = [],
}) => {
  const [activeTab, setActiveTab] = useState<SettingsSubTab>(() => {
    const valid = SUB_TABS.some(s => s.id === initialSubTab);
    return valid ? (initialSubTab as SettingsSubTab) : "general";
  });

  // Sync with external initialSubTab changes (e.g. deep-link from Dashboard)
  useEffect(() => {
    if (initialSubTab && SUB_TABS.some(s => s.id === initialSubTab)) {
      setActiveTab(initialSubTab as SettingsSubTab);
    }
  }, [initialSubTab]);

  return (
    <div>
      <div className={mobile ? "mb-3" : "mb-4"}>
        <h1 data-testid="aegis-settings-heading" className={cn(
          "font-[800] text-foreground m-0 tracking-tight",
          mobile ? "text-[18px]" : "text-h1"
        )}>
          Settings
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1 mb-0">
          Configure your agent, feeds &amp; account
        </p>
      </div>

      <div className={cn(
        "flex gap-1 bg-navy-lighter rounded-md p-1 border border-border overflow-x-auto",
        mobile ? "mb-3" : "mb-4"
      )} style={{ WebkitOverflowScrolling: "touch" }}>
        {SUB_TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              data-testid={`settings-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-2 rounded-sm text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast whitespace-nowrap shrink-0",
                active
                  ? "bg-card border border-emphasis text-foreground"
                  : "bg-transparent border border-transparent text-muted-foreground"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "general" && <GeneralSection mobile={mobile} />}
      {activeTab === "agent" && <AgentSection mobile={mobile} />}
      {activeTab === "feeds" && <FeedSection mobile={mobile} />}
      {activeTab === "data" && <DataSection mobile={mobile} content={content} />}
      {activeTab === "account" && <AccountSection mobile={mobile} linkedAccount={linkedAccount} onLinkChange={onLinkChange} />}
    </div>
  );
};
