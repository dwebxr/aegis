"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useNotify } from "@/contexts/NotificationContext";
import { NostrAccountLink } from "@/components/ui/NostrAccountLink";
import { GitHubIcon } from "@/components/icons";
import { clearUserApiKey } from "@/lib/apiKey/storage";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";
import { cardClass, sectionTitleClass, cancelBtnClass } from "./styles";

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
      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Account</div>
        {isAuthenticated ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="size-[7px] rounded-full bg-emerald-400 shrink-0" />
              <span className="text-caption font-semibold text-emerald-400">Connected</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-caption text-[var(--color-text-disabled)]">Principal:</span>
              <code className="text-tiny font-mono text-secondary-foreground bg-[var(--color-bg-overlay)] px-2 py-0.5 rounded-sm break-all">
                {principalText}
              </code>
              <button
                data-testid="aegis-settings-copy-principal"
                onClick={() => handleCopy(principalText, "principal")}
                className={cn(
                  "px-2 py-0.5 bg-transparent border border-[var(--color-border-subtle)] rounded-sm text-tiny font-semibold cursor-pointer font-[inherit] transition-fast shrink-0",
                  copied === "principal" ? "text-emerald-400" : "text-muted-foreground"
                )}
              >
                {copied === "principal" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-caption text-[var(--color-text-disabled)]">Not connected</span>
            <button
              data-testid="aegis-settings-login"
              onClick={login}
              className="px-4 py-1 bg-gradient-to-br from-blue-600 to-cyan-500 border-none rounded-sm text-white text-caption font-bold cursor-pointer font-[inherit]"
            >
              Login with Internet Identity
            </button>
          </div>
        )}
      </div>

      {onLinkChange && (
        <div className={cardClass(mobile)}>
          <div className={sectionTitleClass}>Nostr Account</div>
          <NostrAccountLink mobile={mobile} account={linkedAccount} onLinkChange={onLinkChange} />
        </div>
      )}

      {/* About */}
      <div className={cardClass(mobile)}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <span className="text-caption font-[800] text-foreground tracking-[2px]">AEGIS</span>
            <span className="text-tiny text-[var(--color-text-disabled)] ml-2">v3.0 — D2A Social Agent Platform</span>
          </div>
          <a
            href="https://github.com/dwebxr/aegis"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-caption text-muted-foreground no-underline"
          >
            <GitHubIcon s={14} />
            <span className="font-semibold text-emerald-400">GitHub</span>
          </a>
        </div>
      </div>

      {isAuthenticated && (
        <div className={cn(cardClass(mobile), "border-red-400/20")}>
          <div className={cn(sectionTitleClass, "text-red-400")}>Danger Zone</div>

          {!showDeleteConfirm ? (
            <button
              data-testid="aegis-settings-delete-data"
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2 bg-red-400/[0.06] border border-red-400/[0.15] rounded-md text-red-400 text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast"
            >
              Delete All Local Data
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-caption text-secondary-foreground leading-snug">
                This will clear all local data including preferences, cache, API keys, and IndexedDB. You will be logged out.
              </div>
              <div className="text-tiny text-[var(--color-text-disabled)] p-2 bg-amber-400/[0.05] rounded-sm border border-amber-400/10 leading-tight">
                Data stored on the Internet Computer (evaluations, sources) remains and will re-sync on next login.
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <input
                  data-testid="aegis-settings-delete-input"
                  type="text"
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder='Type "DELETE" to confirm'
                  className="w-[200px] px-3 py-1 bg-[var(--color-bg-overlay)] border border-red-400/20 rounded-sm text-foreground text-caption font-[inherit] outline-none"
                />
                <button
                  data-testid="aegis-settings-delete-confirm"
                  onClick={handleDeleteLocalData}
                  disabled={deleteInput !== "DELETE" || deleting}
                  className={cn(
                    "px-4 py-1 border border-red-400/20 rounded-sm text-caption font-bold font-[inherit] transition-fast",
                    deleteInput === "DELETE"
                      ? "bg-red-400 text-white cursor-pointer"
                      : "bg-red-400/[0.06] text-red-400 cursor-not-allowed",
                    (deleteInput !== "DELETE" || deleting) && "opacity-50"
                  )}
                >
                  {deleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}
                  className={cancelBtnClass}
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
