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
import { getOllamaConfig, setOllamaConfig } from "@/lib/ollama/storage";
import type { OllamaConfig, OllamaStatus } from "@/lib/ollama/types";
import { DEFAULT_OLLAMA_CONFIG } from "@/lib/ollama/types";
import { NostrAccountLink } from "@/components/ui/NostrAccountLink";
import { FilterModeSelector } from "@/components/filtering/FilterModeSelector";
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

  const [ollamaConfig, setOllamaConfigState] = useState<OllamaConfig>(() => getOllamaConfig());
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({
    connected: false, loading: false, models: [],
  });
  const [ollamaModelInput, setOllamaModelInput] = useState("");

  // Subscribe to WebLLM status when enabled; auto-disable if WebGPU unusable
  useEffect(() => {
    if (!webllmOn) return;
    let unsub: (() => void) | null = null;
    (async () => {
      const { onStatusChange, isWebGPUUsable } = await import("@/lib/webllm/engine");
      if (!(await isWebGPUUsable())) {
        // WebGPU not actually usable — revert persisted toggle
        setWebLLMEnabled(false);
        setWebllmOn(false);
        setWebllmStatus({ available: false, loaded: false, loading: false, progress: 0 });
        return;
      }
      // isWebGPUUsable() already set module currentStatus.available = true,
      // so onStatusChange will immediately fire with the correct state
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
        addNotification("WebGPU not available — see chrome://gpu", "error");
        return;
      }
      setWebLLMEnabled(true);
      setWebllmOn(true);
      addNotification("Browser AI enabled", "success");
    }
  }, [webllmOn, addNotification]);

  const handleOllamaToggle = useCallback(async () => {
    const newEnabled = !ollamaConfig.enabled;
    const updated = { ...ollamaConfig, enabled: newEnabled };
    setOllamaConfig(updated);
    setOllamaConfigState(updated);
    if (newEnabled) {
      addNotification("Local LLM enabled — testing connection...", "success");
      try {
        const { testOllamaConnection } = await import("@/lib/ollama/engine");
        const result = await testOllamaConnection(updated.endpoint);
        setOllamaStatus({ connected: result.ok, loading: false, models: result.models, error: result.error });
        if (!result.ok) {
          addNotification(`Cannot reach Ollama at ${updated.endpoint}`, "error");
        }
      } catch {
        setOllamaStatus(prev => ({ ...prev, connected: false, error: "Connection test failed" }));
      }
    } else {
      setOllamaStatus({ connected: false, loading: false, models: [] });
      addNotification("Local LLM disabled", "success");
    }
  }, [ollamaConfig, addNotification]);

  const handleOllamaEndpointChange = useCallback((endpoint: string) => {
    const updated = { ...ollamaConfig, endpoint };
    setOllamaConfig(updated);
    setOllamaConfigState(updated);
    setOllamaStatus(prev => ({ ...prev, connected: false, models: [] }));
  }, [ollamaConfig]);

  const handleOllamaModelChange = useCallback((model: string) => {
    const updated = { ...ollamaConfig, model };
    setOllamaConfig(updated);
    setOllamaConfigState(updated);
  }, [ollamaConfig]);

  const handleOllamaTest = useCallback(async () => {
    setOllamaStatus(prev => ({ ...prev, loading: true, error: undefined }));
    try {
      const { testOllamaConnection } = await import("@/lib/ollama/engine");
      const result = await testOllamaConnection(ollamaConfig.endpoint);
      setOllamaStatus({ connected: result.ok, loading: false, models: result.models, error: result.error });
      if (result.ok) {
        addNotification(`Connected — ${result.models.length} model(s) available`, "success");
      } else {
        addNotification(`Connection failed: ${result.error || "Unknown error"}`, "error");
      }
    } catch (err) {
      setOllamaStatus(prev => ({ ...prev, loading: false, connected: false, error: String(err) }));
    }
  }, [ollamaConfig.endpoint, addNotification]);

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
        <h1 data-testid="aegis-settings-heading" style={{ fontSize: mobile ? t.h2.size : t.h1.size, fontWeight: 800, color: colors.text.primary, margin: 0, letterSpacing: -0.5 }}>
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

      {/* Filter Mode */}
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Filter Mode</div>
        <FilterModeSelector />
        <div style={{ marginTop: space[3], display: "flex", flexDirection: "column", gap: space[1] }}>
          {([
            { label: "Local LLM (Ollama)", on: ollamaConfig.enabled },
            { label: "Browser AI (WebLLM)", on: webllmOn },
            { label: "API Key (BYOK)", on: hasApiKey },
            { label: "IC LLM (D2A Agent)", on: agentEnabled },
          ] as const).map(e => (
            <div key={e.label} style={{ display: "flex", alignItems: "center", gap: space[2] }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: e.on ? colors.green[400] : colors.text.disabled,
              }} />
              <span style={{ fontSize: t.caption.size, color: e.on ? colors.text.secondary : colors.text.disabled }}>
                {e.label}
              </span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
          Pro requires at least one AI engine or an active D2A Agent.
        </div>
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

      {/* Local LLM (Ollama) */}
      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Local LLM (Ollama)</div>
        <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
          <button
            onClick={handleOllamaToggle}
            style={{
              position: "relative",
              width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
              background: ollamaConfig.enabled ? colors.cyan[500] : colors.bg.overlay,
              transition: transitions.fast, flexShrink: 0,
            }}
          >
            <div style={{
              position: "absolute", top: 2, left: ollamaConfig.enabled ? 20 : 2,
              width: 18, height: 18, borderRadius: "50%",
              background: ollamaConfig.enabled ? "#fff" : colors.text.disabled,
              transition: transitions.fast,
            }} />
          </button>
          <span style={{ fontSize: t.caption.size, fontWeight: 600, color: ollamaConfig.enabled ? colors.cyan[400] : colors.text.disabled }}>
            {ollamaConfig.enabled ? "Enabled" : "Disabled"}
          </span>
          {ollamaConfig.enabled && (
            <div style={{
              width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
              background: ollamaStatus.connected ? colors.green[400]
                : ollamaStatus.loading ? colors.amber[400]
                : ollamaStatus.error ? colors.red[400]
                : colors.text.disabled,
            }} />
          )}
        </div>

        {ollamaConfig.enabled && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
            {/* Endpoint */}
            <div>
              <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginBottom: space[1] }}>Endpoint</div>
              <div style={{ display: "flex", gap: space[2] }}>
                <input
                  type="text"
                  value={ollamaConfig.endpoint}
                  onChange={e => handleOllamaEndpointChange(e.target.value)}
                  placeholder={DEFAULT_OLLAMA_CONFIG.endpoint}
                  style={{
                    flex: 1, minWidth: 180, padding: `${space[1]}px ${space[3]}px`,
                    background: colors.bg.overlay, border: `1px solid ${colors.border.subtle}`,
                    borderRadius: radii.sm, color: colors.text.primary, fontSize: t.caption.size,
                    fontFamily: fonts.mono, outline: "none",
                  }}
                />
                <button
                  onClick={handleOllamaTest}
                  disabled={ollamaStatus.loading}
                  style={{
                    ...actionBtnStyle,
                    opacity: ollamaStatus.loading ? 0.5 : 1,
                    cursor: ollamaStatus.loading ? "not-allowed" : "pointer",
                  }}
                >
                  {ollamaStatus.loading ? "Testing..." : "Test"}
                </button>
              </div>
            </div>

            {/* Model */}
            <div>
              <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginBottom: space[1] }}>Model</div>
              {ollamaStatus.models.length > 0 ? (
                <select
                  value={ollamaConfig.model}
                  onChange={e => handleOllamaModelChange(e.target.value)}
                  style={{
                    width: "100%", padding: `${space[1]}px ${space[3]}px`,
                    background: colors.bg.overlay, border: `1px solid ${colors.border.subtle}`,
                    borderRadius: radii.sm, color: colors.text.primary, fontSize: t.caption.size,
                    fontFamily: fonts.mono, outline: "none",
                  }}
                >
                  {ollamaStatus.models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <div style={{ display: "flex", gap: space[2] }}>
                  <input
                    type="text"
                    value={ollamaModelInput || ollamaConfig.model}
                    onChange={e => {
                      setOllamaModelInput(e.target.value);
                      handleOllamaModelChange(e.target.value);
                    }}
                    placeholder={DEFAULT_OLLAMA_CONFIG.model}
                    style={{
                      flex: 1, minWidth: 120, padding: `${space[1]}px ${space[3]}px`,
                      background: colors.bg.overlay, border: `1px solid ${colors.border.subtle}`,
                      borderRadius: radii.sm, color: colors.text.primary, fontSize: t.caption.size,
                      fontFamily: fonts.mono, outline: "none",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Status */}
            {ollamaStatus.connected && (
              <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: colors.green[400], flexShrink: 0 }} />
                <span style={{ fontSize: t.caption.size, color: colors.green[400] }}>
                  Connected — using {ollamaConfig.model}
                </span>
              </div>
            )}

            {/* CORS hint on error */}
            {ollamaStatus.error && (
              <div style={{
                fontSize: t.tiny.size, color: colors.amber[400], lineHeight: t.tiny.lineHeight,
                background: `${colors.amber[400]}0D`, padding: space[2], borderRadius: radii.sm,
                border: `1px solid ${colors.amber[400]}1A`,
              }}>
                {ollamaStatus.error.includes("fetch") || ollamaStatus.error.includes("Failed") ? (
                  <>Cannot reach server. If Ollama is running, set <code style={{ fontFamily: fonts.mono }}>OLLAMA_ORIGINS=*</code> or restart with <code style={{ fontFamily: fonts.mono }}>OLLAMA_ORIGINS=https://aegis.dwebxr.xyz</code></>
                ) : (
                  ollamaStatus.error
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: space[2], lineHeight: t.tiny.lineHeight }}>
          Connect to Ollama or any OpenAI-compatible local LLM server. Tried first when enabled — zero cost, fully private.
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
