"use client";
import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ShareIcon } from "@/components/icons";
import { serializeBriefing } from "@/lib/briefing/serialize";
import { publishBriefingToNostr } from "@/lib/nostr/publish";
import type { BriefingState } from "@/lib/briefing/types";
import { errMsg } from "@/lib/utils/errors";

interface ShareBriefingModalProps {
  briefing: BriefingState;
  nostrKeys: { sk: Uint8Array; pk: string };
  onClose: () => void;
  mobile?: boolean;
  onTabChange?: (tab: string) => void;
}

type Phase = "confirm" | "publishing" | "success" | "error";

export const ShareBriefingModal: React.FC<ShareBriefingModalProps> = ({
  briefing,
  nostrKeys,
  onClose,
  mobile,
  onTabChange,
}) => {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [shareUrl, setShareUrl] = useState("");
  const [naddr, setNaddr] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); };
  }, []);

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
      setErrorMsg(errMsg(err));
      setPhase("error");
    }
  };

  const handleCopy = async () => {
    const resetCopied = () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      setCopied(true);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    };
    try {
      await navigator.clipboard.writeText(shareUrl);
      resetCopied();
    } catch {
      const input = document.createElement("input");
      try {
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        resetCopied();
      } finally {
        input.parentNode?.removeChild(input);
      }
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

  const cancelBtnClass = "px-4 py-2 bg-transparent border border-border rounded-md text-[var(--color-text-tertiary)] text-body cursor-pointer font-[inherit] transition-fast";
  const primaryBtnClass = "px-5 py-2 bg-gradient-to-br from-purple-600 to-blue-600 border-none rounded-md text-white text-body font-semibold cursor-pointer font-[inherit] transition-fast";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-w-[480px] bg-navy-lighter border border-[var(--color-border-emphasis)] rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.5)]",
          mobile ? "w-[92vw] p-5" : "w-[480px] p-6"
        )}
      >
        {phase === "confirm" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <ShareIcon s={22} />
              <h2 className="text-h2 font-bold text-foreground m-0">
                Share Briefing
              </h2>
            </div>

            <p className="text-body text-secondary-foreground leading-normal mb-4">
              This will publish your briefing as a{" "}
              <span className="text-purple-400">Nostr long-form article</span>{" "}
              (NIP-23) visible to anyone with the link.
            </p>

            <div className="bg-card border border-border rounded-md p-4 mb-4">
              <div className="text-body-sm font-semibold text-green-400 mb-2">
                What&apos;s shared:
              </div>
              <ul className="m-0 pl-5 text-body-sm text-[var(--color-text-tertiary)] leading-loose">
                <li>{insightCount} curated items with scores &amp; verdicts</li>
                <li>Topics, reasons, source links</li>
                <li>{onTabChange ? (
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); onClose(); onTabChange("settings:account"); }}
                    className="text-purple-400 underline cursor-pointer"
                  >Your Nostr public key</a>
                ) : (
                  "Your Nostr public key"
                )}</li>
              </ul>
            </div>

            <div className="bg-card border border-border rounded-md p-4 mb-5">
              <div className="text-body-sm font-semibold text-muted-foreground mb-2">
                NOT shared:
              </div>
              <ul className="m-0 pl-5 text-body-sm text-muted-foreground leading-loose">
                <li>Your preference profile</li>
                <li>Filtered-out items ({briefing.filteredOut.length} burned)</li>
                <li>Browsing history or source list</li>
              </ul>
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className={cancelBtnClass}>Cancel</button>
              <button onClick={handleShare} className={primaryBtnClass}>Share Briefing</button>
            </div>
          </>
        )}

        {phase === "publishing" && (
          <div className="text-center p-6">
            <div className="size-10 border-[3px] border-border border-t-purple-400 rounded-full animate-spin mx-auto mb-4" />
            <div className="text-h3 font-semibold text-foreground">
              Publishing to Nostr...
            </div>
            <div className="text-body-sm text-muted-foreground mt-2">
              Signing &amp; broadcasting to relays
            </div>
          </div>
        )}

        {phase === "success" && (
          <>
            <div className="text-center mb-5">
              <div className="text-[36px] mb-2">&#x2705;</div>
              <h2 className="text-h2 font-bold text-foreground m-0">
                Briefing Shared!
              </h2>
            </div>

            <div className="bg-card border border-border rounded-md p-3 mb-4 flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-transparent border-none text-cyan-400 text-body-sm font-mono outline-none overflow-hidden text-ellipsis"
              />
              <button
                onClick={handleCopy}
                className={cn(
                  "px-3 py-1 rounded-sm text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast whitespace-nowrap border",
                  copied
                    ? "bg-green-400/[0.06] border-green-400/15 text-green-400"
                    : "bg-navy-lighter border-border text-[var(--color-text-tertiary)]"
                )}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <div className="flex gap-2 mb-4 flex-wrap">
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button
                  onClick={handleWebShare}
                  className="flex-1 px-3 py-2 bg-card border border-border rounded-md text-secondary-foreground text-body-sm font-semibold cursor-pointer font-[inherit] transition-fast"
                >
                  Share...
                </button>
              )}
              <a
                href={`https://x.com/intent/tweet?text=${encodeURIComponent(`Aegis Briefing \u2014 ${insightCount} curated insights`)}&url=${encodeURIComponent(shareUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-3 py-2 bg-card border border-border rounded-md text-secondary-foreground text-body-sm font-semibold cursor-pointer no-underline text-center transition-fast"
              >
                Post on X
              </a>
              <a
                href={`https://njump.me/${naddr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-3 py-2 bg-card border border-border rounded-md text-purple-400 text-body-sm font-semibold cursor-pointer no-underline text-center transition-fast"
              >
                View on njump.me
              </a>
            </div>

            <button onClick={onClose} className={cn(cancelBtnClass, "w-full")}>Done</button>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="text-center mb-4">
              <div className="text-[36px] mb-2">&#x26A0;&#xFE0F;</div>
              <h2 className="text-h2 font-bold text-red-400 m-0">
                Share Failed
              </h2>
            </div>

            <div className="bg-red-400/[0.06] border border-red-400/15 rounded-md p-4 mb-5 text-body-sm text-red-400 break-words">
              {errorMsg}
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className={cancelBtnClass}>Close</button>
              <button onClick={() => { setPhase("confirm"); setErrorMsg(""); }} className={primaryBtnClass}>Try Again</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
