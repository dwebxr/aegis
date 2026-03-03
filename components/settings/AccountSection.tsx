"use client";
import React, { useState } from "react";
import { colors, space, type as t, radii, transitions, fonts } from "@/styles/theme";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import { NostrAccountLink } from "@/components/ui/NostrAccountLink";
import { GitHubIcon } from "@/components/icons";
import { clearUserApiKey } from "@/lib/apiKey/storage";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";
import { cardStyle, sectionTitle } from "./styles";

interface AccountSectionProps {
  mobile?: boolean;
  linkedAccount?: LinkedNostrAccount | null;
  onLinkChange?: (account: LinkedNostrAccount | null) => void;
}

export const AccountSection: React.FC<AccountSectionProps> = ({ mobile, linkedAccount, onLinkChange }) => {
  const { isAuthenticated, principalText, login, logout } = useAuth();
  const { addNotification } = useNotify();

  const [copied, setCopied] = useState<string | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      addNotification("Failed to copy to clipboard", "error");
    }
  };

  const handleDeleteLocalData = async () => {
    if (deleteInput !== "DELETE") return;
    setDeleting(true);
    try {
      // Clear all aegis-prefixed localStorage keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("aegis")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      clearUserApiKey();

      const dbNames = ["aegis-content", "aegis-dedup", "aegis-sources"];
      await Promise.allSettled(
        dbNames.map(name => new Promise<void>((resolve, reject) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })),
      );

      await logout();
      addNotification("All local data deleted", "success");
      window.location.reload();
    } catch {
      setDeleting(false);
      addNotification("Failed to delete local data", "error");
    }
  };

  return (
    <>
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Account</div>
        {isAuthenticated ? (
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: colors.green[400], flexShrink: 0 }} />
              <span style={{ fontSize: t.caption.size, fontWeight: 600, color: colors.green[400] }}>Connected</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>Principal:</span>
              <code style={{
                fontSize: t.tiny.size, fontFamily: fonts.mono, color: colors.text.secondary,
                background: colors.bg.overlay, padding: `2px ${space[2]}px`, borderRadius: radii.sm,
                wordBreak: "break-all",
              }}>
                {principalText}
              </code>
              <button
                data-testid="aegis-settings-copy-principal"
                onClick={() => handleCopy(principalText, "principal")}
                style={{
                  padding: `2px ${space[2]}px`, background: "transparent",
                  border: `1px solid ${colors.border.subtle}`, borderRadius: radii.sm,
                  color: copied === "principal" ? colors.green[400] : colors.text.muted,
                  fontSize: t.tiny.size, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  transition: transitions.fast, flexShrink: 0,
                }}
              >
                {copied === "principal" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
            <span style={{ fontSize: t.caption.size, color: colors.text.disabled }}>Not connected</span>
            <button
              data-testid="aegis-settings-login"
              onClick={login}
              style={{
                padding: `${space[1]}px ${space[4]}px`,
                background: `linear-gradient(135deg, ${colors.blue[600]}, ${colors.cyan[500]})`,
                border: "none", borderRadius: radii.sm, color: "#fff",
                fontSize: t.caption.size, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Login with Internet Identity
            </button>
          </div>
        )}
      </div>

      {onLinkChange && (
        <div style={cardStyle(mobile)}>
          <div style={sectionTitle}>Nostr Account</div>
          <NostrAccountLink mobile={mobile} account={linkedAccount} onLinkChange={onLinkChange} />
        </div>
      )}

      {/* About */}
      <div style={cardStyle(mobile)}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space[2] }}>
          <div>
            <span style={{ fontSize: t.caption.size, fontWeight: 800, color: colors.text.primary, letterSpacing: 2 }}>AEGIS</span>
            <span style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginLeft: space[2] }}>v3.0 — D2A Social Agent Platform</span>
          </div>
          <a
            href="https://github.com/dwebxr/aegis"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: t.caption.size, color: colors.text.muted, textDecoration: "none",
            }}
          >
            <GitHubIcon s={14} />
            <span style={{ fontWeight: 600, color: colors.green[400] }}>GitHub</span>
          </a>
        </div>
      </div>

      {isAuthenticated && (
        <div style={{
          ...cardStyle(mobile),
          border: `1px solid ${colors.red[400]}33`,
        }}>
          <div style={{ ...sectionTitle, color: colors.red[400] }}>Danger Zone</div>

          {!showDeleteConfirm ? (
            <button
              data-testid="aegis-settings-delete-data"
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                padding: `${space[2]}px ${space[4]}px`,
                background: `${colors.red[400]}10`,
                border: `1px solid ${colors.red[400]}25`,
                borderRadius: radii.md,
                color: colors.red[400],
                fontSize: t.bodySm.size, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
                transition: transitions.fast,
              }}
            >
              Delete All Local Data
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
              <div style={{ fontSize: t.caption.size, color: colors.text.secondary, lineHeight: t.caption.lineHeight }}>
                This will clear all local data including preferences, cache, API keys, and IndexedDB. You will be logged out.
              </div>
              <div style={{
                fontSize: t.tiny.size, color: colors.text.disabled,
                padding: space[2], background: `${colors.amber[400]}0D`,
                borderRadius: radii.sm, border: `1px solid ${colors.amber[400]}1A`,
                lineHeight: t.tiny.lineHeight,
              }}>
                Data stored on the Internet Computer (evaluations, sources) remains and will re-sync on next login.
              </div>
              <div style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
                <input
                  data-testid="aegis-settings-delete-input"
                  type="text"
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder='Type "DELETE" to confirm'
                  style={{
                    width: 200, padding: `${space[1]}px ${space[3]}px`,
                    background: colors.bg.overlay, border: `1px solid ${colors.red[400]}33`,
                    borderRadius: radii.sm, color: colors.text.primary, fontSize: t.caption.size,
                    fontFamily: "inherit", outline: "none",
                  }}
                />
                <button
                  data-testid="aegis-settings-delete-confirm"
                  onClick={handleDeleteLocalData}
                  disabled={deleteInput !== "DELETE" || deleting}
                  style={{
                    padding: `${space[1]}px ${space[4]}px`,
                    background: deleteInput === "DELETE" ? colors.red[400] : `${colors.red[400]}10`,
                    border: `1px solid ${colors.red[400]}33`,
                    borderRadius: radii.sm,
                    color: deleteInput === "DELETE" ? "#fff" : colors.red[400],
                    fontSize: t.caption.size, fontWeight: 700,
                    cursor: deleteInput === "DELETE" && !deleting ? "pointer" : "not-allowed",
                    fontFamily: "inherit", transition: transitions.fast,
                    opacity: deleteInput === "DELETE" && !deleting ? 1 : 0.5,
                  }}
                >
                  {deleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}
                  style={{
                    padding: `${space[1]}px ${space[3]}px`,
                    background: "transparent",
                    border: `1px solid ${colors.border.subtle}`,
                    borderRadius: radii.sm,
                    color: colors.text.muted,
                    fontSize: t.caption.size, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
