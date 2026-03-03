"use client";
import React, { useState, useEffect, useCallback } from "react";
import { colors, space, type as t, radii, transitions, fonts } from "@/styles/theme";
import { useAgent } from "@/contexts/AgentContext";
import { useNotify } from "@/contexts/NotificationContext";
import { FilterModeSelector } from "@/components/filtering/FilterModeSelector";
import { getUserApiKey, setUserApiKey, clearUserApiKey, maskApiKey } from "@/lib/apiKey/storage";
import { isWebLLMEnabled, setWebLLMEnabled } from "@/lib/webllm/storage";
import type { WebLLMStatus } from "@/lib/webllm/types";
import { getOllamaConfig, setOllamaConfig } from "@/lib/ollama/storage";
import type { OllamaConfig, OllamaStatus } from "@/lib/ollama/types";
import { DEFAULT_OLLAMA_CONFIG } from "@/lib/ollama/types";
import { cardStyle, sectionTitle, actionBtnStyle, confirmBtnStyle, cancelBtnStyle } from "./styles";

interface FeedSectionProps {
  mobile?: boolean;
}

export const FeedSection: React.FC<FeedSectionProps> = ({ mobile }) => {
  const { isEnabled: agentEnabled } = useAgent();
  const { addNotification } = useNotify();

  const [confirmAction, setConfirmAction] = useState<string | null>(null);
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

  useEffect(() => {
    if (!webllmOn) return;
    let unsub: (() => void) | null = null;
    (async () => {
      const { onStatusChange, isWebGPUUsable } = await import("@/lib/webllm/engine");
      if (!(await isWebGPUUsable())) {
        setWebLLMEnabled(false);
        setWebllmOn(false);
        setWebllmStatus({ available: false, loaded: false, loading: false, progress: 0 });
        return;
      }
      unsub = onStatusChange(setWebllmStatus);
    })();
    return () => { unsub?.(); };
  }, [webllmOn]);

  const handleWebLLMToggle = useCallback(async () => {
    if (webllmOn) {
      setWebLLMEnabled(false);
      setWebllmOn(false);
      const { destroyEngine } = await import("@/lib/webllm/engine");
      await destroyEngine();
      setWebllmStatus({ available: false, loaded: false, loading: false, progress: 0 });
      addNotification("Browser AI disabled", "success");
    } else {
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
        if (!result.ok) addNotification(`Cannot reach Ollama at ${updated.endpoint}`, "error");
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
      if (result.ok) addNotification(`Connected — ${result.models.length} model(s) available`, "success");
      else addNotification(`Connection failed: ${result.error || "Unknown error"}`, "error");
    } catch (err) {
      setOllamaStatus(prev => ({ ...prev, loading: false, connected: false, error: String(err) }));
    }
  }, [ollamaConfig.endpoint, addNotification]);

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

  return (
    <>
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
                <button data-testid="aegis-settings-apikey-clear" onClick={handleClearApiKey} style={actionBtnStyle}>Clear</button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
            <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
              <input
                data-testid="aegis-settings-apikey-input"
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
                data-testid="aegis-settings-apikey-save"
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

      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Local LLM (Ollama)</div>
        <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
          <button
            data-testid="aegis-settings-ollama-toggle"
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
                <input
                  type="text"
                  value={ollamaModelInput || ollamaConfig.model}
                  onChange={e => {
                    setOllamaModelInput(e.target.value);
                    handleOllamaModelChange(e.target.value);
                  }}
                  placeholder={DEFAULT_OLLAMA_CONFIG.model}
                  style={{
                    width: "100%", padding: `${space[1]}px ${space[3]}px`,
                    background: colors.bg.overlay, border: `1px solid ${colors.border.subtle}`,
                    borderRadius: radii.sm, color: colors.text.primary, fontSize: t.caption.size,
                    fontFamily: fonts.mono, outline: "none",
                  }}
                />
              )}
            </div>

            {ollamaStatus.connected && (
              <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: colors.green[400], flexShrink: 0 }} />
                <span style={{ fontSize: t.caption.size, color: colors.green[400] }}>
                  Connected — using {ollamaConfig.model}
                </span>
              </div>
            )}

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

      <div style={cardStyle(mobile)}>
        <div style={sectionTitle}>Browser AI</div>
        <div style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[3] }}>
          <button
            data-testid="aegis-settings-webllm-toggle"
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
    </>
  );
};
