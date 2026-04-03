import type { MediaPipeConfig, MediaPipeModelId } from "./types";
import { DEFAULT_MEDIAPIPE_CONFIG, MEDIAPIPE_MODELS } from "./types";

const STORAGE_KEY = "aegis-mediapipe-config";

export function getMediaPipeConfig(): MediaPipeConfig {
  if (typeof globalThis.localStorage === "undefined") return DEFAULT_MEDIAPIPE_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MEDIAPIPE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<MediaPipeConfig>;
    const modelId =
      typeof parsed.modelId === "string" && parsed.modelId in MEDIAPIPE_MODELS
        ? (parsed.modelId as MediaPipeModelId)
        : DEFAULT_MEDIAPIPE_CONFIG.modelId;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
      modelId,
    };
  } catch {
    return DEFAULT_MEDIAPIPE_CONFIG;
  }
}

export function setMediaPipeConfig(config: MediaPipeConfig): void {
  if (typeof globalThis.localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function getSelectedMediaPipeModelId(): MediaPipeModelId {
  return getMediaPipeConfig().modelId;
}

export function isMediaPipeEnabled(): boolean {
  return getMediaPipeConfig().enabled;
}

export function setMediaPipeEnabled(enabled: boolean): void {
  const config = getMediaPipeConfig();
  setMediaPipeConfig({ ...config, enabled });
}
