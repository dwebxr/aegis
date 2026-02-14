"use client";
import React, { useState, useEffect, useCallback } from "react";
import { colors, space, type as t, radii, transitions, fonts } from "@/styles/theme";
import { useAuth } from "@/contexts/AuthContext";
import { useAgent } from "@/contexts/AgentContext";
import { usePushNotification } from "@/hooks/usePushNotification";
import { useNotify } from "@/contexts/NotificationContext";
import { NotificationToggle } from "@/components/ui/NotificationToggle";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
import { GitHubIcon } from "@/components/icons";
import {
  MIN_OFFER_SCORE,
  RESONANCE_THRESHOLD,
  D2A_FEE_TRUSTED,
  D2A_FEE_UNKNOWN,
  D2A_APPROVE_AMOUNT,
} from "@/lib/agent/protocol";
import { getUserApiKey, setUserApiKey, clearUserApiKey, maskApiKey } from "@/lib/apiKey/storage";
import { isWebLLMEnabled, setWebLLMEnabled } from "@/lib/webllm/storage";
import type { WebLLMStatus } from "@/lib/webllm/types";
import { NostrAccountLink } from "@/components/ui/NostrAccountLink";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";

const LS_PUSH_FREQ_KEY = "aegis-push-frequency";

const PUSH_FREQ_OPTIONS = [
  { label: "Off", value: "off" },
  { label: "1x/day", value: "1x_day" },
  { label: "3x/day", value: "3x_day" },
  { label: "Realtime", value: "realtime" },
] as const;

type PushFrequency = typeof PUSH_FREQ_OPTIONS[number]["value"];

interface SettingsTabProps {
  mobile?: boolean;
  onLinkChange?: (account: LinkedNostrAccount | null) => void;
}

const cardStyle = (mobile?: boolean): React.CSSProperties => ({
  background: colors.bg.surface,
  border: `1px solid ${colors.border.default}`,
  borderRadius: radii.lg,
  padding: mobile ? space[4] : space[5],
  marginBottom: mobile ? space[3] : space[4],
});

const sectionTitle: React.CSSProperties = {
  fontSize: t.body.size,
  fontWeight: 700,
  color: colors.text.primary,
  marginBottom: space[3],
  letterSpacing: 0.3,
};

export const SettingsTab: React.FC<SettingsTabProps> = ({ mobile, onLinkChange }) => {
  const { isAuthenticated, principalText, login } = useAuth();
  const { isEnabled: agentEnabled } = useAgent();
  const { isSubscribed } = usePushNotification();
  const { addNotification } = useNotify();

  const [pushFreq, setPushFreq] = useState<PushFrequency>("1x_day");
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasApiKey, setHasApiKey] = useState(() => getUserApiKey() !== null);
  const [maskedKey, setMaskedKey] = useState(() => {
    const key = getUserApiKey();
    return key ? maskApiKey(key) : "";
  });
  const [webllmOn, setWebllmOn] = useState(() => isWebLLMEnabled());
  const [webllmStatus, setWebllmStatus] = useState<WebLLMStatus>({
    available: false, loaded: false, loading: false, progress: 0,
  });

  // Subscribe to WebLLM status when enabled
  useEffect(() => {
    if (!webllmOn) return;
    let unsub: (() => void) | null = null;
    (async () => {
      const { onStatusChange, isWebGPUAvailable } = await import("@/lib/webllm/engine");
      setWebllmStatus(prev => ({ ...prev, available: isWebGPUAvailable() }));
      unsub = onStatusChange(setWebllmStatus);
    })();
    return () => { unsub?.(); };
  }, [webllmOn]);

  const handleWebLLMToggle = useCallback(async () => {
    if (webllmOn) {
      // Turning off — destroy engine if loaded
      setWebLLMEnabled(false);
      setWebllmOn(false);
      const { destroyEngine } = await import("@/lib/webllm/engine");
      await destroyEngine();
      setWebllmStatus({ available: false, loaded: false, loading: false, progress: 0 });
      addNotification("Browser AI disabled", "success");
    } else {
      // Turning on — check WebGPU + GPU adapter
      const { isWebGPUUsable } = await import("@/lib/webllm/engine");
      if (!(await isWebGPUUsable())) {
        addNotification("WebGPU is not available — check chrome://gpu or try enabling chrome://flags/#enable-unsafe-webgpu", "error");
        return;
      }
      setWebLLMEnabled(true);
      setWebllmOn(true);
      addNotification("Browser AI enabled — model will download on first score", "success");
    }
  }, [webllmOn, addNotification]);

  // Load saved frequency on mount
  useEffect(() => {
    const saved = localStorage.getItem(LS_PUSH_FREQ_KEY);
    if (saved && PUSH_FREQ_OPTIONS.some(o => o.value === saved)) {
      setPushFreq(saved as PushFrequency);
    }
  }, []);

  const handleFreqChange = (value: PushFrequency) => {
    setPushFreq(value);
    localStorage.setItem(LS_PUSH_FREQ_KEY, value);
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      addNotification("Failed to copy to clipboard", "error");
    }
  };

  const handleClearCache = () => {
    if (confirmAction !== "clearCache") {
      setConfirmAction("clearCache");
      return;
    }
    localStorage.removeItem("aegis_article_dedup");
    localStorage.removeItem("aegis_source_states");
    setConfirmAction(null);
    addNotification("Content cache cleared", "success");
  };

  const handleSaveApiKey = () => {
    if (!apiKeyInput.startsWith("sk-ant-")) {
      addNotification("Invalid key format — must start with sk-ant-", "error");
      return;
    }
    try {
      setUserApiKey(apiKeyInput);
      setHasApiKey(true);
      setMaskedKey(maskApiKey(apiKeyInput));
      setApiKeyInput("");
      addNotification("API key saved — Pro mode ready", "success");
    } catch {
      addNotification("Failed to save API key", "error");
    }
  };

  const handleClearApiKey = () => {
    if (confirmAction !== "clearApiKey") {
      setConfirmAction("clearApiKey");
      return;
    }
    clearUserApiKey();
    setHasApiKey(false);
    setMaskedKey("");
    setConfirmAction(null);
    addNotification("API key removed", "success");
  };

  const handleResetPrefs = () => {
    if (confirmAction !== "resetPrefs") {
      setConfirmAction("resetPrefs");
      return;
    }
    if (principalText) {
      localStorage.removeItem(`aegis_prefs_${principalText}`);
    }
    setConfirmAction(null);
    addNotification("Preferences reset — reload to apply", "success");
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: mobile ? space[4] : space[6] }}>
        <h1 style={{ fontSize: mobile ? t.h2.size : t.h1.size, fontWeight: 800, color: colors.text.primary, margin: 0, letterSpacing: -0.5 }}>
          Settings
        </h1>
        <p style={{ fontSize: t.body.mobileSz, color: colors.text.muted, margin: `${space[1]}px 0 0` }}>
          Notifications, agent controls & account
        </p>
      </div>

      {/* Push Notifications */}
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Push Notifications</div>
        <NotificationToggle />
        {isSubscribed && (
          <div style={{ marginTop: space[3] }}>
            <div style={{ fontSize: t.caption.size, fontWeight: 600, color: colors.text.muted, marginBottom: space[2] }}>
              Frequency
            </div>
            <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
              {PUSH_FREQ_OPTIONS.map(opt => {
                const active = pushFreq === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleFreqChange(opt.value)}
                    style={{
                      padding: `${space[1]}px ${space[3]}px`,
                      borderRadius: radii.sm,
                      fontSize: t.caption.size,
                      fontWeight: active ? 700 : 500,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      transition: transitions.fast,
                      background: active ? `${colors.cyan[500]}18` : "transparent",
                      color: active ? colors.cyan[400] : colors.text.muted,
                      border: `1px solid ${active ? `${colors.cyan[500]}33` : colors.border.subtle}`,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
              Controls how often briefing alerts are sent. &quot;Off&quot; mutes without unsubscribing.
            </div>
          </div>
        )}
      </div>

      {/* Nostr Account */}
      {onLinkChange && (
        <div style={cardStyle(mobile)}>
          <div style={sectionTitle}>Nostr Account</div>
          <NostrAccountLink mobile={mobile} onLinkChange={onLinkChange} />
        </div>
      )}

      {/* D2A Social Agent */}
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>D2A Social Agent</div>
        <AgentStatusBadge />
        {agentEnabled && (
          <div style={{ marginTop: space[3], display: "flex", flexWrap: "wrap", gap: mobile ? space[3] : space[4] }}>
            {[
              { label: "Min Score", value: MIN_OFFER_SCORE.toFixed(1), color: colors.purple[400] },
              { label: "Resonance", value: RESONANCE_THRESHOLD.toFixed(1), color: colors.sky[400] },
              { label: "Fee Range", value: `${(D2A_FEE_TRUSTED / 1e8).toFixed(4)}–${(D2A_FEE_UNKNOWN / 1e8).toFixed(3)} ICP`, color: colors.amber[400] },
              { label: "Approval", value: `${(D2A_APPROVE_AMOUNT / 1e8).toFixed(1)} ICP`, color: colors.text.muted },
            ].map(p => (
              <div key={p.label} style={{ minWidth: 70 }}>
                <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginBottom: 2 }}>{p.label}</div>
                <div style={{ fontSize: t.caption.size, fontWeight: 700, fontFamily: fonts.mono, color: p.color }}>{p.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Scoring (BYOK) */}
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>AI Scoring</div>
        <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            background: hasApiKey ? colors.green[400] : colors.text.disabled,
          }} />
          <span style={{ fontSize: t.caption.size, fontWeight: 600, color: hasApiKey ? colors.green[400] : colors.text.disabled }}>
            {hasApiKey ? "API Key Set" : "Using server default"}
          </span>
        </div>

        {hasApiKey ? (
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <code style={{
                fontSize: t.tiny.size, fontFamily: fonts.mono, color: colors.text.secondary,
                background: colors.bg.overlay, padding: `2px ${space[2]}px`, borderRadius: radii.sm,
              }}>
                {maskedKey}
              </code>
              {confirmAction === "clearApiKey" ? (
                <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                  <span style={{ fontSize: t.caption.size, color: colors.amber[400], fontWeight: 600 }}>Remove key?</span>
                  <button onClick={handleClearApiKey} style={confirmBtnStyle}>Confirm</button>
                  <button onClick={() => setConfirmAction(null)} style={cancelBtnStyle}>Cancel</button>
                </div>
              ) : (
                <button onClick={handleClearApiKey} style={actionBtnStyle}>Clear</button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
              <input
                type="password"
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                style={{
                  flex: 1, minWidth: 180, padding: `${space[1]}px ${space[3]}px`,
                  background: colors.bg.overlay, border: `1px solid ${colors.border.subtle}`,
                  borderRadius: radii.sm, color: colors.text.primary, fontSize: t.caption.size,
                  fontFamily: fonts.mono, outline: "none",
                }}
              />
              <button
                onClick={handleSaveApiKey}
                disabled={!apiKeyInput}
                style={{
                  ...actionBtnStyle,
                  opacity: apiKeyInput ? 1 : 0.4,
                  cursor: apiKeyInput ? "pointer" : "not-allowed",
                  background: apiKeyInput ? `${colors.cyan[500]}18` : colors.bg.overlay,
                  color: apiKeyInput ? colors.cyan[400] : colors.text.muted,
                  border: `1px solid ${apiKeyInput ? `${colors.cyan[500]}33` : colors.border.subtle}`,
                }}
              >
                Save
              </button>
            </div>
          </div>
        )}

        <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
          Enter your Anthropic API key to use Pro mode with your own quota. Key is stored in localStorage only.
        </div>
      </div>

      {/* Browser AI (WebLLM) */}
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Browser AI</div>
        <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
          <button
            onClick={handleWebLLMToggle}
            style={{
              position: "relative",
              width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
              background: webllmOn ? colors.cyan[500] : colors.bg.overlay,
              transition: transitions.fast, flexShrink: 0,
            }}
          >
            <div style={{
              position: "absolute", top: 2, left: webllmOn ? 20 : 2,
              width: 18, height: 18, borderRadius: "50%",
              background: webllmOn ? "#fff" : colors.text.disabled,
              transition: transitions.fast,
            }} />
          </button>
          <span style={{ fontSize: t.caption.size, fontWeight: 600, color: webllmOn ? colors.cyan[400] : colors.text.disabled }}>
            {webllmOn ? "Enabled" : "Disabled"}
          </span>
        </div>

        {webllmOn && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: webllmStatus.loaded ? colors.green[400]
                  : webllmStatus.loading ? colors.amber[400]
                  : webllmStatus.available ? colors.text.muted
                  : colors.red[400],
              }} />
              <span style={{ fontSize: t.caption.size, color: colors.text.secondary }}>
                {webllmStatus.error ? `Error: ${webllmStatus.error}`
                  : webllmStatus.loaded ? "Model ready"
                  : webllmStatus.loading ? `Downloading model... ${webllmStatus.progress}%`
                  : webllmStatus.available ? "WebGPU available — model loads on first score"
                  : "WebGPU not available"}
              </span>
            </div>

            {webllmStatus.loading && (
              <div style={{
                height: 4, borderRadius: 2, background: colors.bg.overlay,
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  background: `linear-gradient(90deg, ${colors.cyan[500]}, ${colors.blue[500]})`,
                  width: `${webllmStatus.progress}%`,
                  transition: "width 0.3s ease",
                }} />
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
          Run AI scoring locally via WebGPU (Llama 3.1 8B). Requires a WebGPU-capable browser and ~4GB download. No data leaves your device.
        </div>
      </div>

      {/* Account */}
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

      {/* Data Management */}
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Data Management</div>
        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
          {/* Clear Cache */}
          {confirmAction === "clearCache" ? (
            <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
              <span style={{ fontSize: t.caption.size, color: colors.amber[400], fontWeight: 600 }}>Clear cache?</span>
              <button onClick={handleClearCache} style={confirmBtnStyle}>Confirm</button>
              <button onClick={() => setConfirmAction(null)} style={cancelBtnStyle}>Cancel</button>
            </div>
          ) : (
            <button onClick={handleClearCache} style={actionBtnStyle}>
              Clear Content Cache
            </button>
          )}

          {/* Reset Preferences */}
          {confirmAction === "resetPrefs" ? (
            <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
              <span style={{ fontSize: t.caption.size, color: colors.red[400], fontWeight: 600 }}>Reset preferences?</span>
              <button onClick={handleResetPrefs} style={{ ...confirmBtnStyle, color: colors.red[400], borderColor: colors.red.border }}>Confirm</button>
              <button onClick={() => setConfirmAction(null)} style={cancelBtnStyle}>Cancel</button>
            </div>
          ) : (
            <button onClick={handleResetPrefs} disabled={!isAuthenticated} style={{ ...actionBtnStyle, opacity: isAuthenticated ? 1 : 0.4, cursor: isAuthenticated ? "pointer" : "not-allowed" }}>
              Reset Preferences
            </button>
          )}
        </div>
        <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
          Cache stores dedup hashes &amp; source state. Preferences include your topic weights &amp; author quality data.
        </div>
      </div>

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
    </div>
  );
};

// Shared button styles
const actionBtnStyle: React.CSSProperties = {
  padding: `${space[1]}px ${space[3]}px`,
  background: colors.bg.overlay,
  border: `1px solid ${colors.border.subtle}`,
  borderRadius: radii.sm,
  color: colors.text.muted,
  fontSize: t.caption.size,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: transitions.fast,
};

const confirmBtnStyle: React.CSSProperties = {
  padding: `${space[1]}px ${space[3]}px`,
  background: `${colors.amber[400]}1A`,
  border: `1px solid ${colors.amber[400]}33`,
  borderRadius: radii.sm,
  color: colors.amber[400],
  fontSize: t.caption.size,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: `${space[1]}px ${space[3]}px`,
  background: "transparent",
  border: `1px solid ${colors.border.subtle}`,
  borderRadius: radii.sm,
  color: colors.text.muted,
  fontSize: t.caption.size,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
