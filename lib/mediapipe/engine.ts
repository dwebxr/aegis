import type { LlmInference } from "@mediapipe/tasks-genai";
import type { MediaPipeModelId, MediaPipeStatus } from "./types";
import { MEDIAPIPE_MODELS } from "./types";
import { getSelectedMediaPipeModelId } from "./storage";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";
import { createStatusEmitter } from "@/lib/utils/statusEmitter";
import type { ScoreParseResult } from "@/lib/scoring/types";
import { isWebGPUAvailable } from "@/lib/utils/webgpu";

// Re-exported so existing callers (and tests) can keep importing from
// "@/lib/mediapipe/engine".
export { isWebGPUAvailable };

let inference: LlmInference | null = null;
let inferencePromise: Promise<LlmInference> | null = null;
let loadedModelId: MediaPipeModelId | null = null;

const { emit: emitStatus, onStatusChange } = createStatusEmitter<MediaPipeStatus>({
  available: false,
  loaded: false,
  loading: false,
});

export { onStatusChange };

export async function isWebGPUUsable(): Promise<boolean> {
  if (!isWebGPUAvailable()) {
    emitStatus({ available: false, error: "WebGPU not available" });
    return false;
  }
  const gpu = navigator.gpu;
  if (!gpu) {
    emitStatus({ available: false, error: "WebGPU not available" });
    return false;
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    emitStatus({ available: false, error: "No GPU adapter found" });
    return false;
  }
  emitStatus({ available: true });
  return true;
}

/** Extract a useful message from any thrown value (Error, Event, string, etc.) */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  // WebGPU/wasm failures often throw Event objects instead of Error instances
  if (err && typeof err === "object" && "type" in err) {
    const event = err as { type: string; message?: string };
    const detail = event.message || event.type;
    // Safari/iOS WebGPU: insufficient maxStorageBufferBindingSize or missing compute shaders
    const isSafari = typeof navigator !== "undefined" && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    if (isSafari) {
      return `Browser not supported: Safari's WebGPU lacks features required by MediaPipe. Use Chrome on Android, or wait for iOS 26+ Safari. (${detail})`;
    }
    return `WebGPU/wasm error: ${detail}`;
  }
  return String(err);
}

export async function getOrCreateInference(): Promise<LlmInference> {
  const selectedId = getSelectedMediaPipeModelId();

  if (inference && loadedModelId !== selectedId) {
    await destroyInference();
  }
  if (inference) return inference;
  if (inferencePromise) return inferencePromise;

  inferencePromise = (async () => {
    if (!(await isWebGPUUsable())) {
      throw new Error("WebGPU not available");
    }

    emitStatus({ available: true, loading: true, modelId: selectedId });

    const { FilesetResolver, LlmInference: LlmInferenceCtor } = await import(
      "@mediapipe/tasks-genai"
    );
    // Pin to installed version to prevent JS/wasm version mismatch
    const genai = await FilesetResolver.forGenAiTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.27/wasm",
    );

    const modelDef = MEDIAPIPE_MODELS[selectedId];

    try {
      const created = await LlmInferenceCtor.createFromOptions(genai, {
        baseOptions: { modelAssetPath: modelDef.taskFileUrl },
        maxTokens: 1000,
        topK: 40,
        temperature: 0.3,
        randomSeed: 42,
      });
      inference = created;
      loadedModelId = selectedId;
      emitStatus({ loaded: true, loading: false, modelId: selectedId });
      return inference;
    } catch (err) {
      const msg = describeError(err);
      // Gemma 3n E2B / Gemma 4 E2B known issue: Array buffer allocation failed
      if (
        msg.includes("Array buffer allocation failed") ||
        msg.toLowerCase().includes("out of memory")
      ) {
        emitStatus({
          loading: false,
          error: `Memory error: ${modelDef.label} is too large for this device. Switch to Gemma 3 1B in settings.`,
          modelId: selectedId,
        });
      } else {
        emitStatus({ loading: false, error: msg, modelId: selectedId });
      }
      throw err;
    }
  })();

  inferencePromise.catch((err) => {
    console.warn("[mediapipe] Engine creation failed:", describeError(err));
    inferencePromise = null;
  });

  return inferencePromise;
}

export async function scoreWithMediaPipe(
  text: string,
  userTopics: string[],
): Promise<ScoreParseResult> {
  const inf = await getOrCreateInference();
  const prompt = buildScoringPrompt(text, userTopics);
  const raw = await inf.generateResponse(prompt);
  const result = parseScoreResponse(raw);
  if (!result) throw new Error("No JSON object found in MediaPipe response");
  return result;
}

export function isMediaPipeLoaded(): boolean {
  return inference !== null;
}

export async function destroyInference(): Promise<void> {
  if (inference) {
    inference.close();
  }
  inference = null;
  inferencePromise = null;
  loadedModelId = null;
  emitStatus({ loaded: false, loading: false, modelId: undefined, error: undefined });
}
