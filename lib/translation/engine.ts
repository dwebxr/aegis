import type { TranslationLanguage, TranslationBackend, TranslationResult } from "./types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { buildTranslationPrompt, isAlreadyInTarget, parseTranslationResponse } from "./prompt";
import { lookupTranslation, storeTranslation } from "./cache";
import { getOllamaConfig, isOllamaEnabled } from "@/lib/ollama/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { isWebLLMLoaded } from "@/lib/webllm/engine";
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

export async function translateContent(opts: TranslateOptions): Promise<TranslationResult | null> {
  const { text, reason, targetLanguage, backend, actorRef, isAuthenticated } = opts;

  const cached = await lookupTranslation(text, targetLanguage);
  if (cached) return cached;

  const prompt = buildTranslationPrompt(text, targetLanguage, reason);

  let raw = "";
  let usedBackend = "";

  if (backend === "local") {
    raw = await translateWithOllama(prompt);
    usedBackend = "ollama";
  } else if (backend === "browser") {
    raw = await translateWithWebLLM(prompt);
    usedBackend = "webllm";
  } else if (backend === "cloud") {
    const key = getUserApiKey();
    raw = await translateWithClaude(prompt, key);
    usedBackend = key ? "claude-byok" : "claude-server";
  } else if (backend === "ic") {
    if (!actorRef || !isAuthenticated) throw new Error("IC requires authentication");
    raw = await translateWithIC(prompt, actorRef);
    usedBackend = "ic-llm";
  } else {
    const attempts: Array<{ name: string; fn: () => Promise<string> }> = [];

    if (isOllamaEnabled()) {
      attempts.push({ name: "ollama", fn: () => translateWithOllama(prompt) });
    }
    if (isWebLLMEnabled() && isWebLLMLoaded()) {
      attempts.push({ name: "webllm", fn: () => translateWithWebLLM(prompt) });
    }
    if (actorRef?.current && isAuthenticated) {
      attempts.push({ name: "ic-llm", fn: () => translateWithIC(prompt, actorRef) });
    }
    const byokKey = getUserApiKey();
    if (byokKey) {
      attempts.push({ name: "claude-byok", fn: () => translateWithClaude(prompt, byokKey) });
    }
    // Server Claude as last resort
    attempts.push({ name: "claude-server", fn: () => translateWithClaude(prompt, null) });

    for (const attempt of attempts) {
      try {
        raw = await attempt.fn();
        usedBackend = attempt.name;
        break;
      } catch (err) {
        console.debug(`[translate] ${attempt.name} failed:`, errMsg(err));
      }
    }

    if (!usedBackend) return null;
  }

  if (!raw || isAlreadyInTarget(raw)) return null;

  const parsed = parseTranslationResponse(raw);
  if (!parsed) return null;

  const result: TranslationResult = {
    translatedText: parsed.text,
    translatedReason: parsed.reason,
    targetLanguage,
    backend: usedBackend,
    generatedAt: Date.now(),
  };

  await storeTranslation(text, result);
  return result;
}
