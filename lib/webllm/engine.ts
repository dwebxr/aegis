import type { MLCEngine } from "@mlc-ai/web-llm";
import type { WebLLMStatus } from "./types";
import type { ScoreParseResult } from "@/lib/scoring/types";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";
import { createStatusEmitter } from "@/lib/utils/statusEmitter";
import { isWebGPUAvailable } from "@/lib/utils/webgpu";
import { LOCAL_SCORE_TIMEOUT_MS, LocalEngineInitPendingError, runWithLocalEngine } from "@/lib/localAI/budget";

// Re-exported so existing callers (and tests) can keep importing from
// "@/lib/webllm/engine".
export { isWebGPUAvailable };

const MODEL_ID = "Llama-3.1-8B-Instruct-q4f16_1-MLC";

let engine: MLCEngine | null = null;
let enginePromise: Promise<MLCEngine> | null = null;
let generation = 0;

const { emit: emitStatus, onStatusChange } = createStatusEmitter<WebLLMStatus>({
  available: false,
  loaded: false,
  loading: false,
  progress: 0,
});

export { onStatusChange };

export async function isWebGPUUsable(): Promise<boolean> {
  const currentGeneration = generation;
  if (!isWebGPUAvailable()) return false;
  const gpu = navigator.gpu;
  if (!gpu) return false;
  const adapter = await gpu.requestAdapter();
  const usable = adapter !== null;
  if (currentGeneration === generation && usable) {
    emitStatus({ available: true });
  }
  return usable;
}

export async function getOrCreateEngine(): Promise<MLCEngine> {
  if (engine) return engine;
  if (enginePromise) return enginePromise;

  const initGeneration = generation;
  const isCurrent = () => initGeneration === generation;
  // Assign immediately so concurrent callers share the same promise.
  const pending = (async () => {
    emitStatus({ loading: true, progress: 0, error: undefined });
    try {
      const usable = await isWebGPUUsable();
      if (!isCurrent()) throw new LocalEngineInitPendingError("webllm");
      if (!usable) {
        emitStatus({ available: false });
        throw new Error("WebGPU not available — no GPU adapter found");
      }

      const webllm = await import("@mlc-ai/web-llm");
      if (!isCurrent()) throw new LocalEngineInitPendingError("webllm");
      const created = await webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (report) => {
          if (isCurrent()) emitStatus({ progress: Math.round(report.progress * 100) });
        },
      });
      if (!isCurrent()) {
        await created.unload();
        throw new LocalEngineInitPendingError("webllm");
      }
      engine = created;
      emitStatus({ loaded: true, loading: false, progress: 100, error: undefined });
      return created;
    } catch (err) {
      if (isCurrent()) emitStatus({ loading: false, error: String(err) });
      throw err;
    }
  })();
  enginePromise = pending;

  void pending.catch(() => {
    if (enginePromise === pending) enginePromise = null;
  });
  return pending;
}

export async function scoreWithWebLLM(
  text: string,
  userTopics: string[],
): Promise<ScoreParseResult> {
  const prompt = buildScoringPrompt(text, userTopics);

  // MLCEngine uses OpenAI-compatible chat.completions.create() API
  const response = await runWithLocalEngine({
    engine: "webllm",
    init: getOrCreateEngine,
    infer: eng => eng.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    }),
    inferTimeoutMs: LOCAL_SCORE_TIMEOUT_MS,
  });

  const raw = response.choices[0]?.message?.content || "";
  const result = parseScoreResponse(raw);
  if (!result) throw new Error("No JSON object found in WebLLM response");
  return result;
}

export function isWebLLMLoaded(): boolean {
  return engine !== null;
}

export async function destroyEngine(): Promise<void> {
  generation++;
  const previous = engine;
  engine = null;
  enginePromise = null;
  emitStatus({ loaded: false, loading: false, progress: 0, error: undefined });
  await previous?.unload();
}
