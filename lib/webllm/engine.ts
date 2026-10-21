import type { MLCEngine } from "@mlc-ai/web-llm";
import type { WebLLMStatus } from "./types";
import type { ScoreParseResult } from "@/lib/scoring/types";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";
import { createStatusEmitter } from "@/lib/utils/statusEmitter";
import { isWebGPUAvailable } from "@/lib/utils/webgpu";
import {
  LOCAL_SCORE_TIMEOUT_MS,
  LOCAL_INIT_COOLDOWN_MS,
  LOCAL_INIT_DEADLINE_MS,
  LocalEngineInitFailedError,
  LocalEngineUnavailableError,
  LocalEngineInitPendingError,
  createLocalEngineInitError,
  assertLocalEngineReady,
  clearLocalEngineRecovery,
  resetLocalEngine,
  runWithLocalEngine,
} from "@/lib/localAI/budget";
import { errMsg } from "@/lib/utils/errors";

// Re-exported so existing callers (and tests) can keep importing from
// "@/lib/webllm/engine".
export { isWebGPUAvailable };

const MODEL_ID = "Llama-3.1-8B-Instruct-q4f16_1-MLC";

let engine: MLCEngine | null = null;
let enginePromise: Promise<MLCEngine> | null = null;
let initDeadline: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let initFailure: { error: LocalEngineInitFailedError | LocalEngineUnavailableError; retryAt: number } | null = null;

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
  if (initFailure && Date.now() < initFailure.retryAt) throw initFailure.error;

  assertLocalEngineReady("webllm");

  const initGeneration = generation;
  const isCurrent = () => initGeneration === generation;
  let deadline: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => {
      const error = new LocalEngineInitFailedError("webllm", "The browser AI model initialization timed out. Please retry shortly.", undefined);
      if (isCurrent()) {
        // Retire this attempt before any late result can publish an instance.
        generation++;
        emitStatus({ loading: false, error: error.message });
      }
      reject(error);
    }, LOCAL_INIT_DEADLINE_MS);
    initDeadline = deadline;
  });
  // Assign immediately so concurrent callers share the same promise and deadline.
  const pending = Promise.race([expired, (async () => {
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
      if (!isCurrent()) throw err;
      emitStatus({ loading: false, error: String(err) });
      throw createLocalEngineInitError("webllm", errMsg(err), err);
    }
  })()]).finally(() => {
    clearTimeout(deadline);
    if (initDeadline === deadline) initDeadline = undefined;
  });
  enginePromise = pending;

  void pending.catch((error) => {
    if (enginePromise === pending) {
      enginePromise = null;
      initFailure = { error, retryAt: error instanceof LocalEngineUnavailableError ? Infinity : Date.now() + LOCAL_INIT_COOLDOWN_MS };
    }
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
    priority: "scoring",
    init: getOrCreateEngine,
    infer: eng => eng.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    }),
    inferTimeoutMs: LOCAL_SCORE_TIMEOUT_MS,
    interrupt: eng => eng.interruptGenerate(),
    destroy: destroyEngine,
  });

  const raw = response.choices[0]?.message?.content || "";
  const result = parseScoreResponse(raw);
  if (!result) throw new Error("No JSON object found in WebLLM response");
  return result;
}

export function isWebLLMLoaded(): boolean {
  return engine !== null;
}

export async function destroyEngine(expected?: MLCEngine): Promise<void> {
  if (expected && engine !== expected) return;
  // A safety teardown retains recovery; user toggles/model changes clear it.
  if (!expected) clearLocalEngineRecovery("webllm");
  generation++;
  clearTimeout(initDeadline);
  initDeadline = undefined;
  const previous = engine;
  engine = null;
  enginePromise = null;
  initFailure = null;
  if (previous) resetLocalEngine(previous);
  emitStatus({ loaded: false, loading: false, progress: 0, error: undefined });
  await previous?.unload();
}
