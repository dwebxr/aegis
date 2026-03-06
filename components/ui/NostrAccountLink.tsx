"use client";
import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  getLinkedAccount,
  linkNostrAccount,
  clearLinkedAccount,
  maskNpub,
} from "@/lib/nostr/linkAccount";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";

interface NostrAccountLinkProps {
  mobile?: boolean;
  /** Externally-controlled account state (e.g. after IC hydration). Overrides internal state when provided. */
  account?: LinkedNostrAccount | null;
  onLinkChange: (account: LinkedNostrAccount | null) => void;
}

const smallBtn = "px-2 py-1 rounded-sm text-tiny font-semibold cursor-pointer font-[inherit]";

export const NostrAccountLink: React.FC<NostrAccountLinkProps> = ({ mobile, account: externalAccount, onLinkChange }) => {
  const [internalAccount, setInternalAccount] = useState<LinkedNostrAccount | null>(() => getLinkedAccount());
  const account = externalAccount !== undefined ? externalAccount : internalAccount;
  const [input, setInput] = useState("");
  const [linking, setLinking] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const handleLink = useCallback(async () => {
    if (!input.trim() || linking) return;
    setError("");
    setLinking(true);
    try {
      const linked = await linkNostrAccount(input.trim(), setProgress);
      setInternalAccount(linked);
      setInput("");
      onLinkChange(linked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to link account");
    } finally {
      setLinking(false);
      setProgress("");
    }
  }, [input, linking, onLinkChange]);

  const handleUnlink = useCallback(() => {
    if (!confirmUnlink) {
      setConfirmUnlink(true);
      return;
    }
    clearLinkedAccount();
    setInternalAccount(null);
    setConfirmUnlink(false);
    onLinkChange(null);
  }, [confirmUnlink, onLinkChange]);

  const isLinked = account !== null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className={cn(
          "size-[7px] rounded-full shrink-0",
          isLinked ? "bg-green-400" : "bg-[var(--color-text-disabled)]"
        )} />
        <span className={cn(
          "text-caption font-semibold",
          isLinked ? "text-green-400" : "text-[var(--color-text-disabled)]"
        )}>
          {isLinked
            ? `${account.displayName || maskNpub(account.npub)} · ${account.followCount} follows`
            : "Not linked"}
        </span>
      </div>

      {isLinked ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-tiny font-mono text-secondary-foreground bg-[var(--color-bg-overlay)] px-2 py-px rounded-sm">
              {maskNpub(account.npub)}
            </code>
            <span className="text-caption text-muted-foreground">
              {account.followCount} follows
            </span>
            {confirmUnlink ? (
              <div className="flex items-center gap-2">
                <span className="text-caption text-amber-400 font-semibold">
                  Unlink account?
                </span>
                <button onClick={handleUnlink} className={cn(smallBtn, "bg-red-500/[0.09] text-red-400 border border-red-500/20")}>
                  Confirm
                </button>
                <button onClick={() => setConfirmUnlink(false)} className={cn(smallBtn, "bg-transparent text-muted-foreground border border-[var(--color-border-subtle)]")}>
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={handleUnlink} className={cn(smallBtn, "bg-transparent text-muted-foreground border border-[var(--color-border-subtle)] transition-fast")}>
                Unlink
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); setError(""); }}
              placeholder="npub1... or hex pubkey"
              disabled={linking}
              className={cn(
                "flex-1 px-3 py-1 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)] rounded-sm text-foreground text-caption font-mono outline-none",
                mobile ? "min-w-[140px]" : "min-w-[180px]"
              )}
            />
            <button
              onClick={handleLink}
              disabled={linking || !input.trim()}
              className={cn(
                "px-3 py-1 rounded-sm text-caption font-bold font-[inherit] transition-fast",
                linking
                  ? "bg-[var(--color-bg-overlay)] text-[var(--color-text-disabled)] border border-[var(--color-border-subtle)] cursor-wait"
                  : "bg-cyan-500/[0.09] text-cyan-400 border border-cyan-500/20 cursor-pointer"
              )}
            >
              {linking ? "Linking..." : "Link"}
            </button>
          </div>

          {linking && progress && (
            <div className="text-tiny text-cyan-400">{progress}</div>
          )}

          {error && (
            <div className="text-tiny text-red-400">{error}</div>
          )}

          <div className="text-tiny text-[var(--color-text-disabled)] mt-1 leading-[1.5]">
            Link your existing Nostr account to power Web of Trust filtering
          </div>
        </div>
      )}
    </div>
  );
};
