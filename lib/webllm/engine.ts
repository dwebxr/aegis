import type { WebLLMScoreResult, WebLLMStatus } from "./types";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";
import { createStatusEmitter } from "@/lib/utils/statusEmitter";

const MODEL_ID = "Llama-3.1-8B-Instruct-q4f16_1-MLC";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let enginePromise: Promise<any> | null = null;

const { emit: emitStatus, onStatusChange } = createStatusEmitter<WebLLMStatus>({
  available: false,
  loaded: false,
  loading: false,
  progress: 0,
});

export { onStatusChange };

export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function isWebGPUUsable(): Promise<boolean> {
  if (!isWebGPUAvailable()) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as any).gpu;
  const adapter = await gpu.requestAdapter();
  const usable = adapter !== null;
  if (usable) {
    emitStatus({ available: true });
  }
  return usable;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getOrCreateEngine(): Promise<any> {
  if (engine) return engine;
  if (enginePromise) return enginePromise;

  // Assign immediately so concurrent callers share the same promise
  enginePromise = (async () => {
    if (!(await isWebGPUUsable())) {
      emitStatus({ available: false, error: "WebGPU not available — no GPU adapter found" });
      throw new Error("WebGPU not available");
    }

    emitStatus({ available: true, loading: true, progress: 0 });

    const webllm = await import("@mlc-ai/web-llm");
    const created = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        const pct = Math.round(report.progress * 100);
        emitStatus({ progress: pct });
      },
    });
    engine = created;
    emitStatus({ loaded: true, loading: false, progress: 100 });
    return engine;
  })();

  enginePromise.catch((err) => {
    emitStatus({ loading: false, error: String(err) });
    enginePromise = null;
  });

  return enginePromise;
}

export async function scoreWithWebLLM(
  text: string,
  userTopics: string[],
): Promise<WebLLMScoreResult> {
  const eng = await getOrCreateEngine();
  const prompt = buildScoringPrompt(text, userTopics);

  // MLCEngine uses OpenAI-compatible chat.completions.create() API
  const response = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 500,
  });

  const raw = response.choices[0]?.message?.content || "";
  const result = parseScoreResponse(raw);
  if (!result) throw new Error("No JSON object found in WebLLM response");
  return result;
}

export async function destroyEngine(): Promise<void> {
  if (engine && typeof engine.unload === "function") {
    await engine.unload();
  }
  engine = null;
  enginePromise = null;
  emitStatus({ loaded: false, loading: false, progress: 0 });
}
