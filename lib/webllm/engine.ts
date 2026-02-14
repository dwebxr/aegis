import type { WebLLMScoreResult, WebLLMStatus } from "./types";

const MODEL_ID = "Llama-3.1-8B-Instruct-q4f16_1-MLC";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let enginePromise: Promise<any> | null = null;
let statusListeners: Array<(status: WebLLMStatus) => void> = [];
let currentStatus: WebLLMStatus = {
  available: false,
  loaded: false,
  loading: false,
  progress: 0,
};

function emitStatus(partial: Partial<WebLLMStatus>): void {
  currentStatus = { ...currentStatus, ...partial };
  for (const listener of statusListeners) {
    listener(currentStatus);
  }
}

export function onStatusChange(listener: (status: WebLLMStatus) => void): () => void {
  statusListeners.push(listener);
  listener(currentStatus);
  return () => {
    statusListeners = statusListeners.filter(l => l !== listener);
  };
}

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

function buildScoringPrompt(text: string, userTopics: string[]): string {
  const contentSlice = text.slice(0, 3000);
  const topicsStr = userTopics.length > 0 ? userTopics.join(", ") : "general";

  return `You are a content quality evaluator. Score this content.

User interests: ${topicsStr}

Score each 0-10:
- vSignal: Information density & novelty
- cContext: Relevance to user interests
- lSlop: Clickbait/engagement farming (higher = more slop)
- originality: Novel or rehashed?
- insight: Deep analysis or surface-level?
- credibility: Reliable sourcing?

Composite: S = (vSignal * cContext) / (lSlop + 0.5), normalize 0-10.
Verdict: "quality" if composite >= 4, else "slop".

Content: "${contentSlice}"

Respond ONLY in JSON: {"vSignal":N,"cContext":N,"lSlop":N,"originality":N,"insight":N,"credibility":N,"composite":N.N,"verdict":"quality"|"slop","reason":"brief","topics":["tag1"]}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseScoreResponse(raw: string): WebLLMScoreResult {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("No JSON object found in response");
  }
  const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(jsonStr);

  const vSignal = clamp(num(parsed.vSignal, 5), 0, 10);
  const cContext = clamp(num(parsed.cContext, 5), 0, 10);
  const lSlop = clamp(num(parsed.lSlop, 5), 0, 10);
  const originality = clamp(num(parsed.originality, 5), 0, 10);
  const insight = clamp(num(parsed.insight, 5), 0, 10);
  const credibility = clamp(num(parsed.credibility, 5), 0, 10);
  const composite = clamp(num(parsed.composite, originality * 0.4 + insight * 0.35 + credibility * 0.25), 0, 10);
  const verdict: "quality" | "slop" = parsed.verdict === "quality" ? "quality" : "slop";
  const reason = typeof parsed.reason === "string" ? parsed.reason : "Scored by WebLLM (local)";
  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.filter((t: unknown) => typeof t === "string").slice(0, 5)
    : [];

  return { originality, insight, credibility, composite, verdict, reason, topics, vSignal, cContext, lSlop };
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
  return parseScoreResponse(raw);
}

export async function destroyEngine(): Promise<void> {
  if (engine && typeof engine.unload === "function") {
    await engine.unload();
  }
  engine = null;
  enginePromise = null;
  emitStatus({ loaded: false, loading: false, progress: 0 });
}
