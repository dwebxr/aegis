"use client";
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAgent } from "@/contexts/AgentContext";
import { useNotify } from "@/contexts/NotificationContext";
import { FilterModeSelector } from "@/components/filtering/FilterModeSelector";
import { getUserApiKey, setUserApiKey, clearUserApiKey, maskApiKey } from "@/lib/apiKey/storage";
import { isWebLLMEnabled, setWebLLMEnabled } from "@/lib/webllm/storage";
import type { WebLLMStatus } from "@/lib/webllm/types";
import { getOllamaConfig, setOllamaConfig } from "@/lib/ollama/storage";
import type { OllamaConfig, OllamaStatus } from "@/lib/ollama/types";
import { DEFAULT_OLLAMA_CONFIG } from "@/lib/ollama/types";
import { cardClass, sectionTitleClass, actionBtnClass, confirmBtnClass, cancelBtnClass } from "./styles";

interface FeedSectionProps {
  mobile?: boolean;
}

const inputClass = "flex-1 min-w-[180px] px-3 py-1 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)] rounded-sm text-foreground text-caption font-mono outline-none";

const statusDot = (on: boolean) => cn(
  "size-[7px] rounded-full shrink-0",
  on ? "bg-emerald-400" : "bg-[var(--color-text-disabled)]"
);

const toggleBase = (on: boolean) => cn(
  "relative w-10 h-[22px] rounded-[11px] border-none cursor-pointer shrink-0 transition-fast",
  on ? "bg-cyan-500" : "bg-[var(--color-bg-overlay)]"
);

const toggleKnob = (on: boolean): React.CSSProperties => ({
  position: "absolute", top: 2, left: on ? 20 : 2,
  width: 18, height: 18, borderRadius: "50%",
  background: on ? "#fff" : "var(--color-text-disabled)",
  transition: "left 0.15s ease",
});

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
      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Filter Mode</div>
        <FilterModeSelector />
        <div className="mt-3 flex flex-col gap-1">
          {([
            { label: "Local LLM (Ollama)", on: ollamaConfig.enabled },
            { label: "Browser AI (WebLLM)", on: webllmOn },
            { label: "API Key (BYOK)", on: hasApiKey },
            { label: "IC LLM (D2A Agent)", on: agentEnabled },
          ] as const).map(e => (
            <div key={e.label} className="flex items-center gap-2">
              <div className={statusDot(e.on)} />
              <span className={cn("text-caption", e.on ? "text-secondary-foreground" : "text-[var(--color-text-disabled)]")}>
                {e.label}
              </span>
            </div>
          ))}
        </div>
        <div className="text-tiny text-[var(--color-text-disabled)] mt-2 leading-tight">
          Pro requires at least one AI engine or an active D2A Agent.
        </div>
      </div>

      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>AI Scoring</div>
        <div className="flex items-center gap-2 mb-3">
          <div className={statusDot(hasApiKey)} />
          <span className={cn("text-caption font-semibold", hasApiKey ? "text-emerald-400" : "text-[var(--color-text-disabled)]")}>
            {hasApiKey ? "API Key Set" : "Using server default"}
          </span>
        </div>

        {hasApiKey ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-tiny font-mono text-secondary-foreground bg-[var(--color-bg-overlay)] px-2 py-0.5 rounded-sm">
                {maskedKey}
              </code>
              {confirmAction === "clearApiKey" ? (
                <div className="flex items-center gap-2">
                  <span className="text-caption text-amber-400 font-semibold">Remove key?</span>
                  <button onClick={handleClearApiKey} className={confirmBtnClass}>Confirm</button>
                  <button onClick={() => setConfirmAction(null)} className={cancelBtnClass}>Cancel</button>
                </div>
              ) : (
                <button data-testid="aegis-settings-apikey-clear" onClick={handleClearApiKey} className={actionBtnClass}>Clear</button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 flex-wrap">
              <input
                data-testid="aegis-settings-apikey-input"
                type="password"
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                className={inputClass}
              />
              <button
                data-testid="aegis-settings-apikey-save"
                onClick={handleSaveApiKey}
                disabled={!apiKeyInput}
                className={cn(
                  "px-3 py-1 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] transition-fast",
                  apiKeyInput
                    ? "bg-cyan-500/[0.09] border border-cyan-500/20 text-cyan-400 opacity-100"
                    : "bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)] text-muted-foreground opacity-40 cursor-not-allowed"
                )}
              >
                Save
              </button>
            </div>
          </div>
        )}
        <div className="text-tiny text-[var(--color-text-disabled)] mt-2 leading-tight">
          Enter your Anthropic API key to use Pro mode with your own quota. Key is stored in localStorage only.
        </div>
      </div>

      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Local LLM (Ollama)</div>
        <div className="flex items-center gap-2 mb-3">
          <button
            data-testid="aegis-settings-ollama-toggle"
            onClick={handleOllamaToggle}
            className={toggleBase(ollamaConfig.enabled)}
          >
            <div style={toggleKnob(ollamaConfig.enabled)} />
          </button>
          <span className={cn("text-caption font-semibold", ollamaConfig.enabled ? "text-cyan-400" : "text-[var(--color-text-disabled)]")}>
            {ollamaConfig.enabled ? "Enabled" : "Disabled"}
          </span>
          {ollamaConfig.enabled && (
            <div className={cn(
              "size-[7px] rounded-full shrink-0",
              ollamaStatus.connected ? "bg-emerald-400"
                : ollamaStatus.loading ? "bg-amber-400"
                : ollamaStatus.error ? "bg-red-400"
                : "bg-[var(--color-text-disabled)]"
            )} />
          )}
        </div>

        {ollamaConfig.enabled && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-tiny text-[var(--color-text-disabled)] mb-1">Endpoint</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={ollamaConfig.endpoint}
                  onChange={e => handleOllamaEndpointChange(e.target.value)}
                  placeholder={DEFAULT_OLLAMA_CONFIG.endpoint}
                  className={inputClass}
                />
                <button
                  onClick={handleOllamaTest}
                  disabled={ollamaStatus.loading}
                  className={cn(actionBtnClass, ollamaStatus.loading && "opacity-50 cursor-not-allowed")}
                >
                  {ollamaStatus.loading ? "Testing..." : "Test"}
                </button>
              </div>
            </div>

            <div>
              <div className="text-tiny text-[var(--color-text-disabled)] mb-1">Model</div>
              {ollamaStatus.models.length > 0 ? (
                <select
                  value={ollamaConfig.model}
                  onChange={e => handleOllamaModelChange(e.target.value)}
                  className="w-full px-3 py-1 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)] rounded-sm text-foreground text-caption font-mono outline-none"
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
                  className="w-full px-3 py-1 bg-[var(--color-bg-overlay)] border border-[var(--color-border-subtle)] rounded-sm text-foreground text-caption font-mono outline-none"
                />
              )}
            </div>

            {ollamaStatus.connected && (
              <div className="flex items-center gap-2">
                <div className="size-[7px] rounded-full bg-emerald-400 shrink-0" />
                <span className="text-caption text-emerald-400">
                  Connected — using {ollamaConfig.model}
                </span>
              </div>
            )}

            {ollamaStatus.error && (
              <div className="text-tiny text-amber-400 leading-tight bg-amber-400/[0.05] p-2 rounded-sm border border-amber-400/10">
                {ollamaStatus.error.includes("fetch") || ollamaStatus.error.includes("Failed") ? (
                  <>Cannot reach server. If Ollama is running, set <code className="font-mono">OLLAMA_ORIGINS=*</code> or restart with <code className="font-mono">OLLAMA_ORIGINS=https://aegis.dwebxr.xyz</code></>
                ) : (
                  ollamaStatus.error
                )}
              </div>
            )}
          </div>
        )}
        <div className="text-tiny text-[var(--color-text-disabled)] mt-2 leading-tight">
          Connect to Ollama or any OpenAI-compatible local LLM server. Tried first when enabled — zero cost, fully private.
        </div>
      </div>

      <div className={cardClass(mobile)}>
        <div className={sectionTitleClass}>Browser AI</div>
        <div className="flex items-center gap-2 mb-3">
          <button
            data-testid="aegis-settings-webllm-toggle"
            onClick={handleWebLLMToggle}
            className={toggleBase(webllmOn)}
          >
            <div style={toggleKnob(webllmOn)} />
          </button>
          <span className={cn("text-caption font-semibold", webllmOn ? "text-cyan-400" : "text-[var(--color-text-disabled)]")}>
            {webllmOn ? "Enabled" : "Disabled"}
          </span>
        </div>

        {webllmOn && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className={cn(
                "size-[7px] rounded-full shrink-0",
                webllmStatus.loaded ? "bg-emerald-400"
                  : webllmStatus.loading ? "bg-amber-400"
                  : webllmStatus.available ? "bg-muted-foreground"
                  : "bg-red-400"
              )} />
              <span className="text-caption text-secondary-foreground">
                {webllmStatus.error ? `Error: ${webllmStatus.error}`
                  : webllmStatus.loaded ? "Model ready"
                  : webllmStatus.loading ? `Downloading model... ${webllmStatus.progress}%`
                  : webllmStatus.available ? "WebGPU available — model loads on first score"
                  : "WebGPU not available"}
              </span>
            </div>

            {webllmStatus.loading && (
              <div className="h-1 rounded-sm bg-[var(--color-bg-overlay)] overflow-hidden">
                <div
                  className="h-full rounded-sm bg-gradient-to-r from-cyan-500 to-blue-500"
                  style={{ width: `${webllmStatus.progress}%`, transition: "width 0.3s ease" }}
                />
              </div>
            )}
          </div>
        )}
        <div className="text-tiny text-[var(--color-text-disabled)] mt-2 leading-tight">
          Run AI scoring locally via WebGPU (Llama 3.1 8B). Requires a WebGPU-capable browser and ~4GB download. No data leaves your device.
        </div>
      </div>
    </>
  );
};
