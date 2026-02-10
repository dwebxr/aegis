"use client";
import React, { useState } from "react";
import { colors, space, type as t, radii, transitions, shadows } from "@/styles/theme";
import { ShareIcon } from "@/components/icons";
import { serializeBriefing } from "@/lib/briefing/serialize";
import { publishBriefingToNostr } from "@/lib/nostr/publish";
import type { BriefingState } from "@/lib/briefing/types";

interface ShareBriefingModalProps {
  briefing: BriefingState;
  nostrKeys: { sk: Uint8Array; pk: string };
  onClose: () => void;
  mobile?: boolean;
}

type Phase = "confirm" | "publishing" | "success" | "error";

export const ShareBriefingModal: React.FC<ShareBriefingModalProps> = ({
  briefing,
  nostrKeys,
  onClose,
  mobile,
}) => {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [shareUrl, setShareUrl] = useState("");
  const [naddr, setNaddr] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const insightCount = briefing.priority.length + (briefing.serendipity ? 1 : 0);

  const handleShare = async () => {
    setPhase("publishing");
    try {
      const serialized = serializeBriefing(briefing);
      const result = await publishBriefingToNostr(serialized, nostrKeys.sk, nostrKeys.pk);

      if (result.relaysPublished.length === 0) {
        setErrorMsg("Failed to publish to any relay. Please try again.");
        setPhase("error");
        return;
      }

      const url = `${window.location.origin}/b/${result.naddr}`;
      setShareUrl(url);
      setNaddr(result.naddr);
      setPhase("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setPhase("error");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWebShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Aegis Briefing — ${insightCount} insights`,
          url: shareUrl,
        });
      } catch {
        // User cancelled share
      }
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bg.overlay,
        backdropFilter: "blur(8px)",
        animation: "fadeIn .2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: mobile ? "92vw" : 480,
          maxWidth: 480,
          background: colors.bg.raised,
          border: `1px solid ${colors.border.emphasis}`,
          borderRadius: radii.lg,
          boxShadow: shadows.lg,
          padding: mobile ? space[5] : space[6],
        }}
      >
        {phase === "confirm" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[4] }}>
              <ShareIcon s={22} />
              <h2 style={{ fontSize: t.h2.size, fontWeight: t.h2.weight, color: colors.text.primary, margin: 0 }}>
                Share Briefing
              </h2>
            </div>

            <p style={{ fontSize: t.body.size, color: colors.text.secondary, lineHeight: t.body.lineHeight, marginBottom: space[4] }}>
              This will publish your briefing as a{" "}
              <span style={{ color: colors.purple[400] }}>Nostr long-form article</span>{" "}
              (NIP-23) visible to anyone with the link.
            </p>

            <div style={{
              background: colors.bg.surface,
              border: `1px solid ${colors.border.default}`,
              borderRadius: radii.md,
              padding: space[4],
              marginBottom: space[4],
            }}>
              <div style={{ fontSize: t.bodySm.size, fontWeight: 600, color: colors.green[400], marginBottom: space[2] }}>
                What&apos;s shared:
              </div>
              <ul style={{ margin: 0, paddingLeft: space[5], fontSize: t.bodySm.size, color: colors.text.tertiary, lineHeight: 1.8 }}>
                <li>{insightCount} curated items with scores &amp; verdicts</li>
                <li>Topics, reasons, source links</li>
                <li>Your Nostr public key</li>
              </ul>
            </div>

            <div style={{
              background: colors.bg.surface,
              border: `1px solid ${colors.border.default}`,
              borderRadius: radii.md,
              padding: space[4],
              marginBottom: space[5],
            }}>
              <div style={{ fontSize: t.bodySm.size, fontWeight: 600, color: colors.text.muted, marginBottom: space[2] }}>
                NOT shared:
              </div>
              <ul style={{ margin: 0, paddingLeft: space[5], fontSize: t.bodySm.size, color: colors.text.muted, lineHeight: 1.8 }}>
                <li>Your preference profile</li>
                <li>Filtered-out items ({briefing.filteredOut.length} burned)</li>
                <li>Browsing history or source list</li>
              </ul>
            </div>

            <div style={{ display: "flex", gap: space[3], justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  padding: `${space[2]}px ${space[4]}px`,
                  background: "transparent",
                  border: `1px solid ${colors.border.default}`,
                  borderRadius: radii.md,
                  color: colors.text.tertiary,
                  fontSize: t.body.size,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: transitions.fast,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleShare}
                style={{
                  padding: `${space[2]}px ${space[5]}px`,
                  background: `linear-gradient(135deg, ${colors.purple[600]}, ${colors.blue[600]})`,
                  border: "none",
                  borderRadius: radii.md,
                  color: "#fff",
                  fontSize: t.body.size,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: transitions.fast,
                }}
              >
                Share Briefing
              </button>
            </div>
          </>
        )}

        {phase === "publishing" && (
          <div style={{ textAlign: "center", padding: space[6] }}>
            <div style={{
              width: 40,
              height: 40,
              border: `3px solid ${colors.border.default}`,
              borderTopColor: colors.purple[400],
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto",
              marginBottom: space[4],
            }} />
            <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.primary }}>
              Publishing to Nostr...
            </div>
            <div style={{ fontSize: t.bodySm.size, color: colors.text.muted, marginTop: space[2] }}>
              Signing &amp; broadcasting to relays
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {phase === "success" && (
          <>
            <div style={{ textAlign: "center", marginBottom: space[5] }}>
              <div style={{ fontSize: 36, marginBottom: space[2] }}>&#x2705;</div>
              <h2 style={{ fontSize: t.h2.size, fontWeight: t.h2.weight, color: colors.text.primary, margin: 0 }}>
                Briefing Shared!
              </h2>
            </div>

            <div style={{
              background: colors.bg.surface,
              border: `1px solid ${colors.border.default}`,
              borderRadius: radii.md,
              padding: space[3],
              marginBottom: space[4],
              display: "flex",
              alignItems: "center",
              gap: space[2],
            }}>
              <input
                readOnly
                value={shareUrl}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  color: colors.cyan[400],
                  fontSize: t.bodySm.size,
                  fontFamily: "monospace",
                  outline: "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              />
              <button
                onClick={handleCopy}
                style={{
                  padding: `${space[1]}px ${space[3]}px`,
                  background: copied ? colors.green.bg : colors.bg.raised,
                  border: `1px solid ${copied ? colors.green.border : colors.border.default}`,
                  borderRadius: radii.sm,
                  color: copied ? colors.green[400] : colors.text.tertiary,
                  fontSize: t.bodySm.size,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: transitions.fast,
                  whiteSpace: "nowrap",
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <div style={{ display: "flex", gap: space[2], marginBottom: space[4] }}>
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button
                  onClick={handleWebShare}
                  style={{
                    flex: 1,
                    padding: `${space[2]}px ${space[3]}px`,
                    background: colors.bg.surface,
                    border: `1px solid ${colors.border.default}`,
                    borderRadius: radii.md,
                    color: colors.text.secondary,
                    fontSize: t.bodySm.size,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: transitions.fast,
                  }}
                >
                  Share...
                </button>
              )}
              <a
                href={`https://njump.me/${naddr}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  padding: `${space[2]}px ${space[3]}px`,
                  background: colors.bg.surface,
                  border: `1px solid ${colors.border.default}`,
                  borderRadius: radii.md,
                  color: colors.purple[400],
                  fontSize: t.bodySm.size,
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "none",
                  textAlign: "center",
                  transition: transitions.fast,
                }}
              >
                View on njump.me
              </a>
            </div>

            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: `${space[2]}px ${space[4]}px`,
                background: "transparent",
                border: `1px solid ${colors.border.default}`,
                borderRadius: radii.md,
                color: colors.text.tertiary,
                fontSize: t.body.size,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: transitions.fast,
              }}
            >
              Done
            </button>
          </>
        )}

        {phase === "error" && (
          <>
            <div style={{ textAlign: "center", marginBottom: space[4] }}>
              <div style={{ fontSize: 36, marginBottom: space[2] }}>&#x26A0;&#xFE0F;</div>
              <h2 style={{ fontSize: t.h2.size, fontWeight: t.h2.weight, color: colors.red[400], margin: 0 }}>
                Share Failed
              </h2>
            </div>

            <div style={{
              background: colors.red.bg,
              border: `1px solid ${colors.red.border}`,
              borderRadius: radii.md,
              padding: space[4],
              marginBottom: space[5],
              fontSize: t.bodySm.size,
              color: colors.red[400],
              wordBreak: "break-word",
            }}>
              {errorMsg}
            </div>

            <div style={{ display: "flex", gap: space[3], justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  padding: `${space[2]}px ${space[4]}px`,
                  background: "transparent",
                  border: `1px solid ${colors.border.default}`,
                  borderRadius: radii.md,
                  color: colors.text.tertiary,
                  fontSize: t.body.size,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: transitions.fast,
                }}
              >
                Close
              </button>
              <button
                onClick={() => { setPhase("confirm"); setErrorMsg(""); }}
                style={{
                  padding: `${space[2]}px ${space[5]}px`,
                  background: `linear-gradient(135deg, ${colors.purple[600]}, ${colors.blue[600]})`,
                  border: "none",
                  borderRadius: radii.md,
                  color: "#fff",
                  fontSize: t.body.size,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: transitions.fast,
                }}
              >
                Try Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
