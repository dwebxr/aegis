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

/**
 * The DFINITY LLM canister is a free shared service backed by AI workers
 * polling a queue. When the queue is busy or a worker drops a request, the
 * call returns `#err("IC LLM translation failed")`. These failures are
 * transient — a retry a second later usually succeeds. We try once more
 * with a short backoff before propagating the error.
 *
 * The error message is rewritten to be operator-friendly so users see why
 * the translation failed and not the raw canister `Debug.print` string.
 */
async function callIC(
  actor: _SERVICE,
  prompt: string,
): Promise<string> {
  const result = await withTimeout(
    actor.translateOnChain(prompt),
    30_000,
    "IC LLM translation timeout",
  );
  if ("err" in result) throw new Error(result.err);
  return result.ok.trim();
}

async function translateWithIC(
  prompt: string,
  actorRef: React.MutableRefObject<_SERVICE | null>,
): Promise<string> {
  const actor = actorRef.current;
  if (!actor) throw new Error("IC actor not available");

  try {
    return await callIC(actor, prompt);
  } catch (err) {
    const message = errMsg(err);
    // Only retry on the canister's transient failure marker. Timeouts and
    // empty-response errors get the same retry — they're symptomatic of
    // the same queue-saturation issue. Auth and timeout-of-the-wrapper
    // errors should NOT be retried.
    if (!/IC LLM translation failed|IC LLM returned empty response/.test(message)) {
      throw err;
    }
    console.debug("[translate] IC LLM transient failure, retrying once after 1s:", message);
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      return await callIC(actor, prompt);
    } catch (retryErr) {
      throw new Error(`IC LLM unavailable (retried once): ${errMsg(retryErr)}`);
    }
  }
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

  /**
   * Surface a validator-rejected outcome from explicit backend mode as a
   * thrown Error with a clear, actionable message. Returning generic
   * "failed" was misleading because the user-facing notification then
   * said "no translation backend available" when in fact only the user's
   * single chosen backend was tried.
   */
  const explicitFailMessage = (label: string, reason: string): string =>
    `${label} returned an unusable response (${reason}). Try switching to Auto in Settings → Translation Engine.`;

  // — Explicit backend selection: a failed outcome throws with the reason. —
  if (backend === "local") {
    const outcome = evaluateRaw(await translateWithOllama(prompt));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFailMessage("Ollama", outcome.reason));
    return finalize(outcome.parsed, "ollama");
  }
  if (backend === "browser") {
    if (isMediaPipeEnabled()) {
      const outcome = evaluateRaw(await translateWithMediaPipe(prompt));
      if (outcome.kind === "skip") return "skip";
      if (outcome.kind === "failed") throw new Error(explicitFailMessage("MediaPipe", outcome.reason));
      return finalize(outcome.parsed, "mediapipe");
    }
    const outcome = evaluateRaw(await translateWithWebLLM(prompt));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFailMessage("WebLLM", outcome.reason));
    return finalize(outcome.parsed, "webllm");
  }
  if (backend === "cloud") {
    const key = getUserApiKey();
    const outcome = evaluateRaw(await translateWithClaude(prompt, key));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFailMessage(key ? "Claude (BYOK)" : "Claude (server)", outcome.reason));
    return finalize(outcome.parsed, key ? "claude-byok" : "claude-server");
  }
  if (backend === "ic") {
    if (!actorRef || !isAuthenticated) throw new Error("IC requires authentication");
    const outcome = evaluateRaw(await translateWithIC(prompt, actorRef));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFailMessage("IC LLM", outcome.reason));
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
    // 15s budget for IC LLM in auto cascade: covers a normal call (~2s) +
    // one retry (~1s backoff + ~5s) + slack for the larger Japanese prompt
    // template that takes the model longer to process. Server Claude is the
    // next attempt and will fire if this budget is exceeded.
    attempts.push({ name: "ic-llm", fn: () => withTimeout(
      translateWithIC(prompt, actorRef), 15_000, "IC LLM auto-cascade timeout",
    ) });
  }
  const byokKey = getUserApiKey();
  if (byokKey) {
    attempts.push({ name: "claude-byok", fn: () => translateWithClaude(prompt, byokKey) });
  }
  // Server Claude as last resort
  attempts.push({ name: "claude-server", fn: () => translateWithClaude(prompt, null) });

  // Collect per-attempt failure reasons. When the cascade exhausts every
  // backend we throw an error containing the full diagnostic so the user
  // (and operators) see WHICH backend failed and WHY. Without this the
  // notification was just "no translation backend available" which gives
  // no actionable information when debugging production issues.
  const failures: Array<{ name: string; reason: string }> = [];

  // Track which "preferred" backends were actually tried in this cascade.
  // The smart-model skip exception (below) should only fire when the
  // user's expected on-device / on-chain backends had their chance —
  // otherwise a cold-start cascade where actor wasn't ready yet would
  // silently skip items that the actor-ready retry would have rescued.
  const icLlmInCascade = attempts.some(a => a.name === "ic-llm");
  const localBackendInCascade = attempts.some(
    a => a.name === "ollama" || a.name === "mediapipe" || a.name === "webllm",
  );

  for (const attempt of attempts) {
    let raw: string;
    try {
      raw = await attempt.fn();
    } catch (err) {
      const reason = errMsg(err);
      console.warn(`[translate] ${attempt.name} transport error:`, reason);
      failures.push({ name: attempt.name, reason });
      continue;
    }
    const outcome = evaluateRaw(raw);
    if (outcome.kind === "ok") {
      return finalize(outcome.parsed, attempt.name);
    }
    if (outcome.kind === "skip") {
      // ALREADY_IN_TARGET is a definitive answer — no later backend can
      // disagree, so propagate immediately rather than retrying.
      return "skip";
    }
    // Smart-model exception: if Claude (server or BYOK) returns a ja-target
    // output without kana AND every preferred backend the user has
    // available was already tried in this cascade, the input is almost
    // certainly untranslatable (URL, code block, single token, emoji,
    // language the model doesn't recognise). Promote to "skip" to stop
    // pestering the user about the item.
    //
    // The "preferred backend was tried" gate is critical: during a
    // cold-start cascade where actorRef.current is still null (IC actor
    // hasn't been created yet) ic-llm is NOT in the attempts list, so
    // claude-server is the only thing that runs. Without this gate the
    // smart-model exception silently skips items that the actor-ready
    // retry hook would have successfully translated via IC LLM seconds
    // later. The same logic applies if the user has WebLLM/Ollama/
    // MediaPipe enabled but they aren't loaded yet — let the cascade
    // fall to "failed" so the retry hook gets a chance.
    const isSmartModel = attempt.name === "claude-server" || attempt.name === "claude-byok";
    const preferredBackendTried = icLlmInCascade || localBackendInCascade;
    if (
      outcome.kind === "failed" &&
      isSmartModel &&
      preferredBackendTried &&
      targetLanguage === "ja" &&
      /no kana/.test(outcome.reason)
    ) {
      return "skip";
    }
    // outcome.kind === "failed" — log, record, and try the next backend
    console.warn(`[translate] ${attempt.name} rejected:`, outcome.reason);
    failures.push({ name: attempt.name, reason: outcome.reason });
  }

  // Cascade exhausted. Throw with a diagnostic message so useTranslation's
  // catch surfaces "Translation failed: <details>" to the user. This
  // replaces the legacy "failed" return that triggered the misleading
  // "no translation backend available" notification.
  const summary = failures.map(f => `${f.name}: ${f.reason}`).join(" | ");
  throw new Error(
    failures.length === 1
      ? `Translation backend failed — ${summary}`
      : `All ${failures.length} translation backends failed — ${summary}`,
  );
}
