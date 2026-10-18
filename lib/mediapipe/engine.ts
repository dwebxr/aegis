import type { LlmInference } from "@mediapipe/tasks-genai";
import type { MediaPipeModelId, MediaPipeStatus } from "./types";
import { MEDIAPIPE_MODELS } from "./types";
import { getSelectedMediaPipeModelId } from "./storage";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";
import { createStatusEmitter } from "@/lib/utils/statusEmitter";
import type { ScoreParseResult } from "@/lib/scoring/types";
import { isWebGPUAvailable } from "@/lib/utils/webgpu";
import { withTimeout } from "@/lib/utils/timeout";
import { LOCAL_SCORE_TIMEOUT_MS, LocalEngineInitPendingError, runWithLocalEngine } from "@/lib/localAI/budget";

// Re-exported so existing callers (and tests) can keep importing from
// "@/lib/mediapipe/engine".
export { isWebGPUAvailable };

export const MEDIAPIPE_GENAI_VERSION = "0.10.29";

let inference: LlmInference | null = null;
let inferencePromise: Promise<LlmInference> | null = null;
let loadedModelId: MediaPipeModelId | null = null;
let initializingModelId: MediaPipeModelId | null = null;
let generation = 0;

const { emit: emitStatus, onStatusChange } = createStatusEmitter<MediaPipeStatus>({
  available: false,
  loaded: false,
  loading: false,
});

export { onStatusChange };

export async function isWebGPUUsable(): Promise<boolean> {
  const currentGeneration = generation;
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
  if (currentGeneration !== generation) return adapter !== null;
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

  if (
    (inference && loadedModelId !== selectedId) ||
    (inferencePromise && initializingModelId !== selectedId)
  ) {
    await destroyInference();
    return getOrCreateInference();
  }
  if (inference) return inference;
  if (inferencePromise) return inferencePromise;

  const initGeneration = generation;
  initializingModelId = selectedId;
  const modelDef = MEDIAPIPE_MODELS[selectedId];
  const basePath = `/vendor/mediapipe/tasks-genai@${MEDIAPIPE_GENAI_VERSION}/wasm`;
  const isCurrent = () => initGeneration === generation;
  const checkCurrent = async () => {
    if (isCurrent() && selectedId !== getSelectedMediaPipeModelId()) await destroyInference();
    if (!isCurrent()) throw new LocalEngineInitPendingError("mediapipe");
  };

  const pending = (async () => {
    let resolvingFiles = false;
    emitStatus({ loading: true, error: undefined, modelId: selectedId });
    try {
      if (!(await isWebGPUUsable())) throw new Error("WebGPU not available");
      await checkCurrent();

      const { FilesetResolver, LlmInference: LlmInferenceCtor } = await import(
        "@mediapipe/tasks-genai"
      );
      await checkCurrent();
      resolvingFiles = true;
      const genai = await FilesetResolver.forGenAiTasks(basePath);
      await checkCurrent();
      const created = await LlmInferenceCtor.createFromOptions(genai, {
        baseOptions: { modelAssetPath: modelDef.taskFileUrl },
        maxTokens: 1000,
        topK: 40,
        temperature: 0.3,
        randomSeed: 42,
      });
      if (!isCurrent() || selectedId !== getSelectedMediaPipeModelId()) {
        created.close();
        await checkCurrent();
      }
      inference = created;
      loadedModelId = selectedId;
      emitStatus({ loaded: true, loading: false, error: undefined, modelId: selectedId });
      return created;
    } catch (err) {
      if (!isCurrent()) throw err;
      const msg = describeError(err);
      // Gemma 3n E2B / Gemma 4 E2B known issue: Array buffer allocation failed
      const error = msg.includes("Array buffer allocation failed") || msg.toLowerCase().includes("out of memory")
        ? `Memory error: ${modelDef.label} is too large for this device. Switch to Gemma 3 1B in settings.`
        : msg;
      emitStatus({ loading: false, error, modelId: selectedId });
      if (resolvingFiles) {
        let missing = false;
        try {
          const response = await withTimeout(
            fetch(`${basePath}/genai_wasm_internal.js`, { method: "HEAD" }),
            3_000,
          );
          missing = response.status === 404;
        } catch {
          // A failed probe cannot distinguish offline from a version change.
        }
        if (missing && isCurrent()) {
          const updated = new Error("AI engine files were updated — reload the page to use the new version.");
          emitStatus({ loading: false, error: updated.message, modelId: selectedId });
          throw updated;
        }
      }
      throw err;
    }
  })();
  inferencePromise = pending;

  void pending.catch((err) => {
    if (inferencePromise === pending) {
      console.warn("[mediapipe] Engine creation failed:", describeError(err));
      inferencePromise = null;
      initializingModelId = null;
    }
  });
  return pending;
}

export async function scoreWithMediaPipe(
  text: string,
  userTopics: string[],
): Promise<ScoreParseResult> {
  const prompt = buildScoringPrompt(text, userTopics);
  const raw = await runWithLocalEngine({
    engine: "mediapipe",
    init: getOrCreateInference,
    infer: inf => inf.generateResponse(prompt),
    inferTimeoutMs: LOCAL_SCORE_TIMEOUT_MS,
  });
  const result = parseScoreResponse(raw);
  if (!result) throw new Error("No JSON object found in MediaPipe response");
  return result;
}

export function isMediaPipeLoaded(): boolean {
  return inference !== null;
}

export async function destroyInference(): Promise<void> {
  generation++;
  const previous = inference;
  inference = null;
  inferencePromise = null;
  loadedModelId = null;
  initializingModelId = null;
  emitStatus({ loaded: false, loading: false, modelId: undefined, error: undefined });
  previous?.close();
}
