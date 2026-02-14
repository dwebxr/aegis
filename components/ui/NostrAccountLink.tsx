"use client";
import React, { useState, useCallback } from "react";
import { colors, space, type as t, radii, transitions, fonts } from "@/styles/theme";
import {
  getLinkedAccount,
  linkNostrAccount,
  clearLinkedAccount,
  maskNpub,
} from "@/lib/nostr/linkAccount";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";

interface NostrAccountLinkProps {
  mobile?: boolean;
  onLinkChange: (account: LinkedNostrAccount | null) => void;
}

export const NostrAccountLink: React.FC<NostrAccountLinkProps> = ({ mobile, onLinkChange }) => {
  const [account, setAccount] = useState<LinkedNostrAccount | null>(() => getLinkedAccount());
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
      setAccount(linked);
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
    setAccount(null);
    setConfirmUnlink(false);
    onLinkChange(null);
  }, [confirmUnlink, onLinkChange]);

  const isLinked = account !== null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
        <div style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: isLinked ? colors.green[400] : colors.text.disabled,
        }} />
        <span style={{
          fontSize: t.caption.size,
          fontWeight: 600,
          color: isLinked ? colors.green[400] : colors.text.disabled,
        }}>
          {isLinked
            ? `${account.displayName || maskNpub(account.npub)} · ${account.followCount} follows`
            : "Not linked"}
        </span>
      </div>

      {isLinked ? (
        <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <code style={{
              fontSize: t.tiny.size, fontFamily: fonts.mono, color: colors.text.secondary,
              background: colors.bg.overlay, padding: `2px ${space[2]}px`, borderRadius: radii.sm,
            }}>
              {maskNpub(account.npub)}
            </code>
            <span style={{ fontSize: t.caption.size, color: colors.text.muted }}>
              {account.followCount} follows
            </span>
            {confirmUnlink ? (
              <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                <span style={{ fontSize: t.caption.size, color: colors.amber[400], fontWeight: 600 }}>
                  Unlink account?
                </span>
                <button onClick={handleUnlink} style={{
                  padding: `${space[1]}px ${space[2]}px`, borderRadius: radii.sm,
                  fontSize: t.tiny.size, fontWeight: 600, cursor: "pointer",
                  background: `${colors.red[500]}18`, color: colors.red[400],
                  border: `1px solid ${colors.red[500]}33`, fontFamily: "inherit",
                }}>
                  Confirm
                </button>
                <button onClick={() => setConfirmUnlink(false)} style={{
                  padding: `${space[1]}px ${space[2]}px`, borderRadius: radii.sm,
                  fontSize: t.tiny.size, fontWeight: 600, cursor: "pointer",
                  background: "transparent", color: colors.text.muted,
                  border: `1px solid ${colors.border.subtle}`, fontFamily: "inherit",
                }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={handleUnlink} style={{
                padding: `${space[1]}px ${space[2]}px`, borderRadius: radii.sm,
                fontSize: t.tiny.size, fontWeight: 600, cursor: "pointer",
                background: "transparent", color: colors.text.muted,
                border: `1px solid ${colors.border.subtle}`, fontFamily: "inherit",
                transition: transitions.fast,
              }}>
                Unlink
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); setError(""); }}
              placeholder="npub1… or hex pubkey"
              disabled={linking}
              style={{
                flex: 1, minWidth: mobile ? 140 : 180, padding: `${space[1]}px ${space[3]}px`,
                background: colors.bg.overlay, border: `1px solid ${colors.border.subtle}`,
                borderRadius: radii.sm, color: colors.text.primary, fontSize: t.caption.size,
                fontFamily: fonts.mono, outline: "none",
              }}
            />
            <button
              onClick={handleLink}
              disabled={linking || !input.trim()}
              style={{
                padding: `${space[1]}px ${space[3]}px`, borderRadius: radii.sm,
                fontSize: t.caption.size, fontWeight: 700, cursor: linking ? "wait" : "pointer",
                fontFamily: "inherit", transition: transitions.fast,
                background: linking ? colors.bg.overlay : `${colors.cyan[500]}18`,
                color: linking ? colors.text.disabled : colors.cyan[400],
                border: `1px solid ${linking ? colors.border.subtle : `${colors.cyan[500]}33`}`,
              }}
            >
              {linking ? "Linking…" : "Link"}
            </button>
          </div>

          {linking && progress && (
            <div style={{ fontSize: t.tiny.size, color: colors.cyan[400] }}>{progress}</div>
          )}

          {error && (
            <div style={{ fontSize: t.tiny.size, color: colors.red[400] }}>{error}</div>
          )}

          <div style={{
            fontSize: t.tiny.size, color: colors.text.disabled,
            marginTop: space[1], lineHeight: 1.5,
          }}>
            Link your existing Nostr account to power Web of Trust filtering
          </div>
        </div>
      )}
    </div>
  );
};
