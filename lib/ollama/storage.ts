import type { OllamaConfig } from "./types";
import { DEFAULT_OLLAMA_CONFIG } from "./types";
import { errMsg } from "@/lib/utils/errors";

const STORAGE_KEY = "aegis-ollama-config";

export function getOllamaConfig(): OllamaConfig {
  if (typeof window === "undefined") return DEFAULT_OLLAMA_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OLLAMA_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_OLLAMA_CONFIG.enabled,
      endpoint: typeof parsed.endpoint === "string" && parsed.endpoint ? parsed.endpoint : DEFAULT_OLLAMA_CONFIG.endpoint,
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : DEFAULT_OLLAMA_CONFIG.model,
    };
  } catch (err) {
    console.warn("[ollama] Failed to parse config:", errMsg(err));
    return DEFAULT_OLLAMA_CONFIG;
  }
}

export function setOllamaConfig(config: OllamaConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Quota exceeded or strict privacy mode
  }
}

export function isOllamaEnabled(): boolean {
  return getOllamaConfig().enabled;
}
