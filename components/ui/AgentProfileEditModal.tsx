"use client";
import React, { useState, useRef, useEffect } from "react";
import { colors, space, type as t, radii, transitions, shadows, fonts } from "@/styles/theme";
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: colors.bg.root,
  border: `1px solid ${colors.border.default}`,
  borderRadius: radii.sm,
  padding: `${space[2]}px ${space[3]}px`,
  color: colors.text.secondary,
  fontSize: t.body.size,
  fontFamily: fonts.sans,
  outline: "none",
  boxSizing: "border-box" as const,
};

const labelStyle: React.CSSProperties = {
  fontSize: t.caption.size,
  fontWeight: 600,
  color: colors.text.muted,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  marginBottom: 6,
  display: "block",
};

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
          maxHeight: "90vh",
          overflowY: "auto",
          background: colors.bg.raised,
          border: `1px solid ${colors.border.emphasis}`,
          borderRadius: radii.lg,
          boxShadow: shadows.lg,
          padding: mobile ? space[5] : space[6],
        }}
      >
        {phase === "edit" && (
          <>
            <h2 style={{
              fontSize: t.h2.size, fontWeight: t.h2.weight,
              color: colors.text.primary, margin: 0, marginBottom: space[5],
            }}>
              Edit Agent Profile
            </h2>

            {/* Avatar */}
            <div style={{ display: "flex", alignItems: "center", gap: space[4], marginBottom: space[5] }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: colors.bg.surface,
                border: `2px solid ${colors.border.default}`,
                overflow: "hidden",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                {picture && !imgError ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={picture}
                    alt="Agent avatar"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <span style={{ fontSize: 28, opacity: 0.4 }}>{"\uD83E\uDD16"}</span>
                )}
              </div>
              <div>
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    display: "flex", alignItems: "center", gap: space[1],
                    padding: `${space[1]}px ${space[3]}px`,
                    background: colors.bg.surface,
                    border: `1px solid ${colors.border.default}`,
                    borderRadius: radii.sm,
                    color: colors.text.tertiary,
                    fontSize: t.bodySm.size,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: fonts.sans,
                    transition: transitions.fast,
                  }}
                >
                  <CameraIcon s={14} /> Upload Image
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                    e.target.value = "";
                  }}
                />
                {picture && (
                  <div style={{
                    fontSize: t.caption.size, color: colors.text.muted,
                    marginTop: space[1], maxWidth: 200,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {picture}
                  </div>
                )}
              </div>
            </div>

            {/* Display Name */}
            <div style={{ marginBottom: space[4] }}>
              <label style={labelStyle}>Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Aegis Agent"
                maxLength={100}
                style={inputStyle}
              />
            </div>

            {/* About */}
            <div style={{ marginBottom: space[4] }}>
              <label style={labelStyle}>About</label>
              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder="A brief description of your agent..."
                rows={3}
                maxLength={500}
                style={{ ...inputStyle, resize: "vertical" as const, lineHeight: 1.6 }}
              />
            </div>

            {/* Website */}
            <div style={{ marginBottom: space[4] }}>
              <label style={labelStyle}>Website</label>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://..."
                style={inputStyle}
              />
            </div>

            {/* Banner */}
            <div style={{ marginBottom: space[5] }}>
              <label style={labelStyle}>Banner Image URL <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
              <input
                type="url"
                value={banner}
                onChange={(e) => setBanner(e.target.value)}
                placeholder="https://..."
                style={inputStyle}
              />
            </div>

            {/* Actions */}
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
                onClick={handleSave}
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
                Save &amp; Publish
              </button>
            </div>
          </>
        )}

        {(phase === "uploading" || phase === "publishing") && (
          <div style={{ textAlign: "center", padding: space[6] }}>
            <div style={{
              width: 40, height: 40,
              border: `3px solid ${colors.border.default}`,
              borderTopColor: colors.purple[400],
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto",
              marginBottom: space[4],
            }} />
            <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.primary }}>
              {phase === "uploading" ? "Uploading image..." : "Publishing profile..."}
            </div>
            {phase === "publishing" && (
              <div style={{ fontSize: t.bodySm.size, color: colors.text.muted, marginTop: space[2] }}>
                Signing &amp; broadcasting Kind 0 to relays
              </div>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {phase === "success" && (
          <div style={{ textAlign: "center", padding: space[6] }}>
            <div style={{ fontSize: 36, marginBottom: space[2] }}>&#x2705;</div>
            <h2 style={{ fontSize: t.h2.size, fontWeight: t.h2.weight, color: colors.text.primary, margin: 0, marginBottom: space[4] }}>
              Profile Published!
            </h2>
            <p style={{ fontSize: t.bodySm.size, color: colors.text.tertiary, marginBottom: space[5] }}>
              Your agent profile is now visible on Nostr relays.
            </p>
            <button
              onClick={() => {
                if (savedProfile) onSaved(savedProfile);
                onClose();
              }}
              style={{
                padding: `${space[2]}px ${space[5]}px`,
                background: `linear-gradient(135deg, ${colors.green[500]}, ${colors.green[400]})`,
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
              Done
            </button>
          </div>
        )}

        {phase === "error" && (
          <>
            <div style={{ textAlign: "center", marginBottom: space[4] }}>
              <div style={{ fontSize: 36, marginBottom: space[2] }}>&#x26A0;&#xFE0F;</div>
              <h2 style={{ fontSize: t.h2.size, fontWeight: t.h2.weight, color: colors.red[400], margin: 0 }}>
                {errorMsg.includes("Upload") || errorMsg.includes("Image") ? "Upload Failed" : "Publish Failed"}
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
                onClick={() => { setPhase("edit"); setErrorMsg(""); }}
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
