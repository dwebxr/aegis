export type MediaPipeModelId = "gemma-3-1b" | "gemma-4-e2b";

interface MediaPipeModelDef {
  label: string;
  description: string;
  sizeEstimateMB: number;
  taskFileUrl: string;
}

export const MEDIAPIPE_MODELS: Record<MediaPipeModelId, MediaPipeModelDef> = {
  "gemma-3-1b": {
    label: "Gemma 3 1B",
    description: "Lightweight, fast on mobile",
    sizeEstimateMB: 700,
    taskFileUrl:
      "https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4-web.task",
  },
  "gemma-4-e2b": {
    label: "Gemma 4 E2B",
    description: "Multimodal, powerful. May fail on low-memory devices.",
    sizeEstimateMB: 2004,
    taskFileUrl:
      "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task",
  },
};

export interface MediaPipeStatus {
  available: boolean;
  loaded: boolean;
  loading: boolean;
  error?: string;
  modelId?: MediaPipeModelId;
  // Note: no progress field — MediaPipe createFromOptions has no progress callback.
  // Unlike web-llm's initProgressCallback, download progress is not observable.
}

export interface MediaPipeConfig {
  enabled: boolean;
  modelId: MediaPipeModelId;
}

export const DEFAULT_MEDIAPIPE_CONFIG: MediaPipeConfig = {
  enabled: false,
  modelId: "gemma-3-1b",
};
