"use client";
import React, { useState, useEffect } from "react";
import { colors, space, type as t, radii, transitions } from "@/styles/theme";
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
      <div style={{ marginBottom: mobile ? space[3] : space[4] }}>
        <h1 data-testid="aegis-settings-heading" style={{ fontSize: mobile ? t.h2.size : t.h1.size, fontWeight: 800, color: colors.text.primary, margin: 0, letterSpacing: -0.5 }}>
          Settings
        </h1>
        <p style={{ fontSize: t.body.mobileSz, color: colors.text.muted, margin: `${space[1]}px 0 0` }}>
          Configure your agent, feeds & account
        </p>
      </div>

      <div style={{
        display: "flex", gap: space[1],
        background: colors.bg.raised, borderRadius: radii.md,
        padding: space[1], border: `1px solid ${colors.border.default}`,
        marginBottom: mobile ? space[3] : space[4],
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {SUB_TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              data-testid={`settings-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: `${space[2]}px ${space[3]}px`,
                background: active ? colors.bg.surface : "transparent",
                border: active ? `1px solid ${colors.border.emphasis}` : "1px solid transparent",
                borderRadius: radii.sm,
                color: active ? colors.text.primary : colors.text.muted,
                fontSize: t.bodySm.size,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: transitions.fast,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
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
