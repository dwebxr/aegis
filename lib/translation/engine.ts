import type { TranslationLanguage, TranslationBackend, TranslationResult } from "./types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { buildTranslationPrompt, parseTranslationResponse } from "./prompt";
import { validateTranslation } from "./validate";
import { lookupTranslation, storeTranslation } from "./cache";
import { getOllamaConfig, isOllamaEnabled } from "@/lib/ollama/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { isWebLLMLoaded } from "@/lib/webllm/engine";
import { isMediaPipeEnabled } from "@/lib/mediapipe/storage";
import { isMediaPipeLoaded } from "@/lib/mediapipe/engine";
import { getUserApiKey } from "@/lib/apiKey/storage";
import { withTimeout } from "@/lib/utils/timeout";
import { errMsg } from "@/lib/utils/errors";

// — Individual backend callers —

async function translateWithOllama(prompt: string): Promise<string> {
  const config = getOllamaConfig();
  const base = config.endpoint.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function translateWithWebLLM(prompt: string): Promise<string> {
  const { getOrCreateEngine } = await import("@/lib/webllm/engine");
  const eng = await getOrCreateEngine();
  const response = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 4000,
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}

async function translateWithMediaPipe(prompt: string): Promise<string> {
  const { getOrCreateInference } = await import("@/lib/mediapipe/engine");
  const inf = await getOrCreateInference();
  const raw = await inf.generateResponse(prompt);
  return raw.trim();
}

async function translateWithClaude(prompt: string, apiKey?: string | null): Promise<string> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-user-api-key": apiKey } : {}),
    },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Translate API HTTP ${res.status}`);
  const data = await res.json();
  return data.translation?.trim() ?? "";
}

async function translateWithIC(
  prompt: string,
  actorRef: React.MutableRefObject<_SERVICE | null>,
): Promise<string> {
  const actor = actorRef.current;
  if (!actor) throw new Error("IC actor not available");
  const result = await withTimeout(
    actor.translateOnChain(prompt),
    30_000,
    "IC LLM translation timeout",
  );
  if ("err" in result) throw new Error(result.err);
  return result.ok.trim();
}

// — Main translation function —

export interface TranslateOptions {
  text: string;
  reason?: string;
  targetLanguage: TranslationLanguage;
  backend: TranslationBackend;
  actorRef?: React.MutableRefObject<_SERVICE | null>;
  isAuthenticated?: boolean;
}

/**
 * Outcome of validating a single backend response. Discriminated union so
 * the explicit-backend code path and the auto-cascade loop can both
 * dispatch on it cleanly without re-parsing.
 */
type BackendOutcome =
  | { kind: "ok"; parsed: { text: string; reason?: string } }
  | { kind: "skip" }
  | { kind: "failed"; reason: string };

export async function translateContent(opts: TranslateOptions): Promise<TranslationResult | "skip" | "failed"> {
  const { text, reason, targetLanguage, backend, actorRef, isAuthenticated } = opts;

  const cached = await lookupTranslation(text, targetLanguage);
  if (cached) return cached;

  const prompt = buildTranslationPrompt(text, targetLanguage, reason);

  /**
   * Parse + validate a raw backend response. Empty / unparseable / validator-
   * rejected outputs are reported as `failed` so callers can decide whether
   * to fall through (cascade) or surface the failure (explicit backend).
   * Transport errors are NOT caught here — they bubble up to the caller.
   */
  const evaluateRaw = (raw: string): BackendOutcome => {
    if (!raw) return { kind: "failed", reason: "empty response" };
    const parsed = parseTranslationResponse(raw);
    if (!parsed) return { kind: "skip" };
    const validation = validateTranslation(parsed.text, targetLanguage, text);
    if (!validation.valid) {
      return { kind: "failed", reason: validation.reason ?? "validation failed" };
    }
    return { kind: "ok", parsed };
  };

  const finalize = async (
    parsed: { text: string; reason?: string },
    usedBackend: string,
  ): Promise<TranslationResult> => {
    const result: TranslationResult = {
      translatedText: parsed.text,
      translatedReason: parsed.reason,
      targetLanguage,
      backend: usedBackend,
      generatedAt: Date.now(),
    };
    await storeTranslation(text, result);
    return result;
  };

  // — Explicit backend selection: a failed/skip outcome surfaces directly. —
  if (backend === "local") {
    const outcome = evaluateRaw(await translateWithOllama(prompt));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") return "failed";
    return finalize(outcome.parsed, "ollama");
  }
  if (backend === "browser") {
    if (isMediaPipeEnabled()) {
      const outcome = evaluateRaw(await translateWithMediaPipe(prompt));
      if (outcome.kind === "skip") return "skip";
      if (outcome.kind === "failed") return "failed";
      return finalize(outcome.parsed, "mediapipe");
    }
    const outcome = evaluateRaw(await translateWithWebLLM(prompt));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") return "failed";
    return finalize(outcome.parsed, "webllm");
  }
  if (backend === "cloud") {
    const key = getUserApiKey();
    const outcome = evaluateRaw(await translateWithClaude(prompt, key));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") return "failed";
    return finalize(outcome.parsed, key ? "claude-byok" : "claude-server");
  }
  if (backend === "ic") {
    if (!actorRef || !isAuthenticated) throw new Error("IC requires authentication");
    const outcome = evaluateRaw(await translateWithIC(prompt, actorRef));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") return "failed";
    return finalize(outcome.parsed, "ic-llm");
  }

  // — Auto cascade: try each backend in order, fall through on validator
  //   rejection so a low-quality IC LLM output is replaced by Claude. —
  const attempts: Array<{ name: string; fn: () => Promise<string> }> = [];

  if (isOllamaEnabled()) {
    attempts.push({ name: "ollama", fn: () => translateWithOllama(prompt) });
  }
  if (isMediaPipeEnabled() && isMediaPipeLoaded()) {
    attempts.push({ name: "mediapipe", fn: () => translateWithMediaPipe(prompt) });
  } else if (isWebLLMEnabled() && isWebLLMLoaded()) {
    attempts.push({ name: "webllm", fn: () => translateWithWebLLM(prompt) });
  }
  if (actorRef?.current && isAuthenticated) {
    attempts.push({ name: "ic-llm", fn: () => withTimeout(
      translateWithIC(prompt, actorRef), 5_000, "IC LLM auto-cascade timeout",
    ) });
  }
  const byokKey = getUserApiKey();
  if (byokKey) {
    attempts.push({ name: "claude-byok", fn: () => translateWithClaude(prompt, byokKey) });
  }
  // Server Claude as last resort
  attempts.push({ name: "claude-server", fn: () => translateWithClaude(prompt, null) });

  let firstSkip = false;
  for (const attempt of attempts) {
    let raw: string;
    try {
      raw = await attempt.fn();
    } catch (err) {
      console.debug(`[translate] ${attempt.name} transport error:`, errMsg(err));
      continue;
    }
    const outcome = evaluateRaw(raw);
    if (outcome.kind === "ok") {
      return finalize(outcome.parsed, attempt.name);
    }
    if (outcome.kind === "skip") {
      // ALREADY_IN_TARGET is a definitive answer — no later backend can
      // disagree, so propagate immediately rather than retrying.
      firstSkip = true;
      break;
    }
    // outcome.kind === "failed" — log and try the next backend
    console.debug(`[translate] ${attempt.name} rejected:`, outcome.reason);
  }

  return firstSkip ? "skip" : "failed";
}
