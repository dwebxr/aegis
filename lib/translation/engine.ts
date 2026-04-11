import type { TranslationLanguage, TranslationBackend, TranslationResult } from "./types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { buildTranslationPrompt, parseTranslationResponse } from "./prompt";
import { validateTranslation } from "./validate";
import { lookupTranslation, storeTranslation } from "./cache";
import { recordTranslationAttempt } from "./debugLog";
import { withIcLlmSlot } from "@/lib/ic/icLlmConcurrency";
// Circuit breaker is still consulted by `callIC` (which reports per-
// call outcomes) — even though auto cascade no longer tries ic-llm,
// the explicit `backend: "ic"` path benefits from the breaker state
// being accurate across sessions. `isIcLlmCircuitOpen` /
// `describeIcLlmCircuitState` are no longer used here because the
// cascade doesn't contain ic-llm to gate.
import { recordIcLlmSuccess, recordIcLlmFailure } from "@/lib/ic/icLlmCircuitBreaker";
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

async function callClaudeOnce(prompt: string, apiKey?: string | null): Promise<string> {
  // 25s budget — warm Claude calls return in 3-6 seconds, production
  // telemetry shows the slowest successful cross-language translation
  // (Chinese → Japanese) at ~9s, and cold-start Vercel functions add
  // another 5-10s on top. Hotfix 13 removed IC LLM from the auto
  // cascade, so claude-server is the only translator for most users —
  // there is no fallback to move on to, and timing out fast no longer
  // buys us anything. Budgeting 25s covers the cold-start tail without
  // stranding items that would otherwise succeed. If even 25s is not
  // enough the user probably has bigger connectivity problems than we
  // can compensate for here.
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-user-api-key": apiKey } : {}),
    },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Translate API HTTP ${res.status}`);
  const data = await res.json();
  return data.translation?.trim() ?? "";
}

/**
 * iOS Safari / iPhone PWA sometimes throws a `TypeError: Load failed`
 * from `fetch()` when the app transitions state (wifi → cellular, tab
 * backgrounded, Service Worker intercept races, etc.). It's a transient
 * network-layer failure — the request never reached Vercel — and the
 * same call succeeds on a 500ms retry. Other browsers use slightly
 * different messages (`Failed to fetch`, `NetworkError when attempting
 * to fetch resource`, `network request failed`) but the same recovery
 * works.
 *
 * We do NOT retry:
 *   - Timeout aborts (`AbortError`): we asked for the cancellation by
 *     wiring `AbortSignal.timeout(12_000)`, so retrying wastes another
 *     12 seconds the user was already waiting for.
 *   - HTTP errors (429, 5xx): these are deterministic server responses;
 *     the retry would hit the same limit or error.
 *
 * Only one retry is attempted. If the second call also fails, the
 * error propagates.
 */
const TRANSIENT_FETCH_ERROR_RE = /Load failed|Failed to fetch|NetworkError|network request failed/i;

function isTransientFetchError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return false;
  const msg = errMsg(err);
  if (/AbortError|aborted|signal is aborted/i.test(msg)) return false;
  return TRANSIENT_FETCH_ERROR_RE.test(msg);
}

async function translateWithClaude(prompt: string, apiKey?: string | null): Promise<string> {
  try {
    return await callClaudeOnce(prompt, apiKey);
  } catch (err) {
    if (!isTransientFetchError(err)) throw err;
    console.debug("[translate] claude-server transient fetch error, retrying once after 500ms:", errMsg(err));
    await new Promise(resolve => setTimeout(resolve, 500));
    return callClaudeOnce(prompt, apiKey);
  }
}

/**
 * The DFINITY LLM canister is a free shared service backed by AI workers
 * polling a queue. When the queue is busy or a worker drops a request,
 * the call returns `#err("IC LLM translation failed")`. We expose a
 * `withRetry` flag so the EXPLICIT IC backend can retry once with a
 * short backoff (the user picked IC, they want it to keep trying), but
 * the AUTO cascade does NOT retry — the cascade itself is the retry
 * mechanism (it falls through to claude-server immediately) and an
 * extra 1-second backoff just adds latency for items that the cascade
 * would otherwise handle in <2 seconds.
 */
async function callIC(
  actor: _SERVICE,
  prompt: string,
): Promise<string> {
  // Wrap the inter-canister call in the shared concurrency gate so we
  // never exceed the DFINITY LLM canister's per-caller limit (currently
  // 2). Without the gate, parallel translateOnChain calls compete with
  // background analyzeOnChain (scoring) calls and the LLM canister
  // rejects the 3rd in-flight request — see lib/ic/icLlmConcurrency.ts.
  //
  // Transport-level outcomes (including `#err` variants) feed the
  // circuit breaker so the cascade can skip ic-llm entirely once it
  // enters a failing streak. A successful raw response (even if the
  // output later fails our validator) resets the breaker — the
  // canister was healthy, the content was the problem.
  let result: { ok: string } | { err: string };
  try {
    result = await withIcLlmSlot(() => withTimeout(
      actor.translateOnChain(prompt),
      30_000,
      "IC LLM translation timeout",
    ));
  } catch (err) {
    recordIcLlmFailure();
    throw err;
  }
  if ("err" in result) {
    recordIcLlmFailure();
    throw new Error(result.err);
  }
  recordIcLlmSuccess();
  return result.ok.trim();
}

async function translateWithIC(
  prompt: string,
  actorRef: React.MutableRefObject<_SERVICE | null>,
  withRetry: boolean = false,
): Promise<string> {
  const actor = actorRef.current;
  if (!actor) throw new Error("IC actor not available");

  if (!withRetry) {
    return callIC(actor, prompt);
  }

  try {
    return await callIC(actor, prompt);
  } catch (err) {
    const message = errMsg(err);
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
    const parsed = parseTranslationResponse(raw, targetLanguage);
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
    // Explicit IC mode: enable the 1-second retry on transient failures
    // because there's no fallback. User picked IC, they want it to try
    // hard before surfacing an error.
    const outcome = evaluateRaw(await translateWithIC(prompt, actorRef, true));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFailMessage("IC LLM", outcome.reason));
    return finalize(outcome.parsed, "ic-llm");
  }

  // — Auto cascade: try each backend in order, fall through on validator
  //   rejection so a low-quality Ollama output is replaced by Claude. —
  //
  // IC LLM is intentionally NOT in this cascade anymore. Production
  // diagnostics (build 442edda, 2026-04-12) showed ic-llm success rate
  // at ~42% with a per-call cost of 7-8s regardless of outcome. On a
  // failure the cascade paid 8s on ic-llm then another 4s on
  // claude-server — for a value (free canister translation) that the
  // 58% failure path undid. The expected-value math favors going
  // claude-server direct: ~4s per item instead of ~10s per item.
  //
  // IC LLM is still available via the explicit `backend: "ic"` path
  // (users who manually pick it in Settings → Translation Engine) and
  // via the scoring cascade (`contexts/content/scoring.ts`) where its
  // 7-8s latency happens in background and is acceptable.
  const attempts: Array<{ name: string; fn: () => Promise<string> }> = [];

  if (isOllamaEnabled()) {
    attempts.push({ name: "ollama", fn: () => translateWithOllama(prompt) });
  }
  if (isMediaPipeEnabled() && isMediaPipeLoaded()) {
    attempts.push({ name: "mediapipe", fn: () => translateWithMediaPipe(prompt) });
  } else if (isWebLLMEnabled() && isWebLLMLoaded()) {
    attempts.push({ name: "webllm", fn: () => translateWithWebLLM(prompt) });
  }
  const byokKey = getUserApiKey();
  if (byokKey) {
    attempts.push({ name: "claude-byok", fn: () => translateWithClaude(prompt, byokKey) });
  }
  // Server Claude as last resort (and the only attempt for most users)
  attempts.push({ name: "claude-server", fn: () => translateWithClaude(prompt, null) });

  // Collect per-attempt failure reasons. When the cascade exhausts every
  // backend we throw an error containing the full diagnostic so the user
  // (and operators) see WHICH backend failed and WHY.
  const failures: Array<{ name: string; reason: string }> = [];
  const itemHint = text.slice(0, 60);

  for (const attempt of attempts) {
    const startedAt = Date.now();
    let raw: string;
    try {
      raw = await attempt.fn();
    } catch (err) {
      const reason = errMsg(err);
      const elapsedMs = Date.now() - startedAt;
      console.warn(`[translate] ${attempt.name} transport error:`, reason);
      failures.push({ name: attempt.name, reason });
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "transport-error", reason, elapsedMs,
      });
      continue;
    }
    const outcome = evaluateRaw(raw);
    const elapsedMs = Date.now() - startedAt;
    if (outcome.kind === "ok") {
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "ok", reason: "", elapsedMs,
      });
      return finalize(outcome.parsed, attempt.name);
    }
    if (outcome.kind === "skip") {
      // ALREADY_IN_TARGET is a definitive answer — no later backend can
      // disagree, so propagate immediately rather than retrying.
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "skip", reason: "ALREADY_IN_TARGET", elapsedMs,
      });
      return "skip";
    }
    // Definitive "untranslatable" verdicts that should short-circuit
    // the cascade and land in the skip set instead of the failed set:
    //
    //   1. Smart-model no-kana for ja target — Claude returned English
    //      meta-commentary or an echoed English fragment, meaning the
    //      content is a URL / code / already-Japanese-but-unparsed.
    //      (Hotfix 5 originally; hotfix 13 dropped the cold-start gate.)
    //
    //   2. Any backend returning output identical to the input — the
    //      translator refused to translate, which is the same signal
    //      as ALREADY_IN_TARGET just in a different shape. Claude does
    //      this for URLs, code blocks, bare filenames, single tokens,
    //      and already-Japanese text that ALREADY_IN_TARGET detection
    //      missed. Retrying is pure waste.
    //
    // Without these promotions the item bounces between failed and
    // retry every 60 seconds forever, burning Anthropic API cycles on
    // content the model has already told us it cannot translate.
    const isSmartModel = attempt.name === "claude-server" || attempt.name === "claude-byok";
    const isNoKanaForJa =
      isSmartModel && targetLanguage === "ja" && /no kana/.test(outcome.reason);
    const isIdenticalToInput = /identical to input/.test(outcome.reason);
    if (outcome.kind === "failed" && (isNoKanaForJa || isIdenticalToInput)) {
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "skip", reason: `untranslatable: ${outcome.reason}`, elapsedMs,
      });
      return "skip";
    }
    // outcome.kind === "failed" — log, record, and try the next backend
    console.warn(`[translate] ${attempt.name} rejected:`, outcome.reason);
    failures.push({ name: attempt.name, reason: outcome.reason });
    recordTranslationAttempt({
      itemHint, targetLanguage, backend: attempt.name,
      outcome: "failed", reason: outcome.reason, elapsedMs,
    });
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
