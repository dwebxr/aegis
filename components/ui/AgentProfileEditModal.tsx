"use client";
import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { CameraIcon } from "@/components/icons";
import { publishAgentProfile, setCachedAgentProfile } from "@/lib/nostr/profile";
import { createNIP98AuthHeader } from "@/lib/nostr/nip98";
import { errMsg } from "@/lib/utils/errors";
import type { NostrProfileMetadata } from "@/lib/nostr/profile";

interface AgentProfileEditModalProps {
  currentProfile: NostrProfileMetadata | null;
  nostrKeys: { sk: Uint8Array; pk: string };
  principalText: string;
  onClose: () => void;
  onSaved: (profile: NostrProfileMetadata) => void;
  mobile?: boolean;
}

type Phase = "edit" | "uploading" | "publishing" | "success" | "error";

const inputClass = "w-full bg-background border border-border rounded-sm px-3 py-2 text-secondary-foreground text-body font-sans outline-none box-border";
const labelClass = "text-caption font-semibold text-muted-foreground uppercase tracking-[1px] mb-1.5 block";

export const AgentProfileEditModal: React.FC<AgentProfileEditModalProps> = ({
  currentProfile,
  nostrKeys,
  principalText,
  onClose,
  onSaved,
  mobile,
}) => {
  const [phase, setPhase] = useState<Phase>("edit");
  const [displayName, setDisplayName] = useState(currentProfile?.display_name || currentProfile?.name || "");
  const [about, setAbout] = useState(currentProfile?.about || "");
  const [website, setWebsite] = useState(currentProfile?.website || "");
  const [picture, setPicture] = useState(currentProfile?.picture || "");
  const [banner, setBanner] = useState(currentProfile?.banner || "");
  const [errorMsg, setErrorMsg] = useState("");
  const [imgError, setImgError] = useState(false);
  const [savedProfile, setSavedProfile] = useState<NostrProfileMetadata | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setImgError(false);
  }, [picture]);

  const handleImageUpload = async (file: File) => {
    if (phase !== "edit") return;
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg("Image must be under 5 MB");
      setPhase("error");
      return;
    }

    setPhase("uploading");
    try {
      const authHeader = createNIP98AuthHeader(
        nostrKeys.sk,
        "https://nostr.build/api/v2/upload/files",
        "POST",
      );
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload/image", {
        method: "POST",
        headers: { Authorization: authHeader },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: undefined }));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      const data = await res.json();
      if (data.url) {
        setPicture(data.url);
      }
      setPhase("edit");
    } catch (err) {
      setErrorMsg(errMsg(err));
      setPhase("error");
    }
  };

  const handleSave = async () => {
    if (phase !== "edit") return;
    setPhase("publishing");
    try {
      const newProfile: NostrProfileMetadata = {
        display_name: displayName.trim(),
        name: displayName.trim(),
        about: about.trim(),
        website: website.trim(),
        picture: picture.trim(),
        banner: banner.trim(),
      };

      const result = await publishAgentProfile(newProfile, nostrKeys.sk, nostrKeys.pk);

      if (result.relaysPublished.length === 0) {
        setErrorMsg("Failed to publish to any relay. Please try again.");
        setPhase("error");
        return;
      }

      setCachedAgentProfile(principalText, result.mergedProfile);
      setSavedProfile(result.mergedProfile);
      setPhase("success");
    } catch (err) {
      setErrorMsg(errMsg(err));
      setPhase("error");
    }
  };

  const cancelBtnClass = "px-4 py-2 bg-transparent border border-border rounded-md text-tertiary text-body cursor-pointer font-[inherit] transition-fast";
  const primaryBtnClass = "px-5 py-2 bg-gradient-to-br from-purple-600 to-blue-600 border-none rounded-md text-white text-body font-semibold cursor-pointer font-[inherit] transition-fast";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-w-[480px] max-h-[90vh] overflow-y-auto bg-navy-lighter border border-emphasis rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.5)]",
          mobile ? "w-[92vw] p-5" : "w-[480px] p-6"
        )}
      >
        {phase === "edit" && (
          <>
            <h2 className="text-h2 font-bold text-foreground m-0 mb-5">
              Edit Agent Profile
            </h2>

            {/* Avatar */}
            <div className="flex items-center gap-4 mb-5">
              <div className="size-16 rounded-full bg-card border-2 border-border overflow-hidden shrink-0 flex items-center justify-center">
                {picture && !imgError ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={picture}
                    alt="Agent avatar"
                    className="w-full h-full object-cover"
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <span className="text-[28px] opacity-40">{"\uD83E\uDD16"}</span>
                )}
              </div>
              <div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1 px-3 py-1 bg-card border border-border rounded-sm text-tertiary text-body-sm font-semibold cursor-pointer font-sans transition-fast"
                >
                  <CameraIcon s={14} /> Upload Image
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImageUpload(file);
                    e.target.value = "";
                  }}
                />
                {picture && (
                  <div className="text-caption text-muted-foreground mt-1 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {picture}
                  </div>
                )}
              </div>
            </div>

            {/* Display Name */}
            <div className="mb-4">
              <label className={labelClass}>Display Name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Aegis Agent" maxLength={100} className={inputClass} />
            </div>

            {/* About */}
            <div className="mb-4">
              <label className={labelClass}>About</label>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} placeholder="A brief description of your agent..." rows={3} maxLength={500} className={cn(inputClass, "resize-y leading-relaxed")} />
            </div>

            {/* Website */}
            <div className="mb-4">
              <label className={labelClass}>Website</label>
              <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className={inputClass} />
            </div>

            {/* Banner */}
            <div className="mb-5">
              <label className={labelClass}>Banner Image URL <span className="font-normal normal-case">(optional)</span></label>
              <input type="url" value={banner} onChange={(e) => setBanner(e.target.value)} placeholder="https://..." className={inputClass} />
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className={cancelBtnClass}>Cancel</button>
              <button onClick={handleSave} className={primaryBtnClass}>Save &amp; Publish</button>
            </div>
          </>
        )}

        {(phase === "uploading" || phase === "publishing") && (
          <div className="text-center p-6">
            <div className="size-10 border-[3px] border-border border-t-purple-400 rounded-full animate-spin mx-auto mb-4" />
            <div className="text-h3 font-semibold text-foreground">
              {phase === "uploading" ? "Uploading image..." : "Publishing profile..."}
            </div>
            {phase === "publishing" && (
              <div className="text-body-sm text-muted-foreground mt-2">
                Signing &amp; broadcasting Kind 0 to relays
              </div>
            )}
          </div>
        )}

        {phase === "success" && (
          <div className="text-center p-6">
            <div className="text-[36px] mb-2">&#x2705;</div>
            <h2 className="text-h2 font-bold text-foreground m-0 mb-4">
              Profile Published!
            </h2>
            <p className="text-body-sm text-tertiary mb-5">
              Your agent profile is now visible on Nostr relays.
            </p>
            <button
              onClick={() => {
                if (savedProfile) onSaved(savedProfile);
                onClose();
              }}
              className="px-5 py-2 bg-gradient-to-br from-green-500 to-green-400 border-none rounded-md text-white text-body font-semibold cursor-pointer font-[inherit] transition-fast"
            >
              Done
            </button>
          </div>
        )}

        {phase === "error" && (
          <>
            <div className="text-center mb-4">
              <div className="text-[36px] mb-2">&#x26A0;&#xFE0F;</div>
              <h2 className="text-h2 font-bold text-red-400 m-0">
                {errorMsg.includes("Upload") || errorMsg.includes("Image") ? "Upload Failed" : "Publish Failed"}
              </h2>
            </div>

            <div className="bg-red-400/[0.06] border border-red-400/15 rounded-md p-4 mb-5 text-body-sm text-red-400 break-words">
              {errorMsg}
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className={cancelBtnClass}>Close</button>
              <button onClick={() => { setPhase("edit"); setErrorMsg(""); }} className={primaryBtnClass}>Try Again</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
