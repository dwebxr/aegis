import * as Sentry from "@sentry/nextjs";
import type { Span } from "@sentry/nextjs";
import {
  TranslationBackendUnavailableError,
  type TranslationLanguage,
  type TranslationBackend,
  type TranslationResult,
  type TranslationSkip,
} from "./types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { buildTranslationPrompt, parseTranslationResponse } from "./prompt";
import { validateTranslation, containsKana } from "./validate";
import { lookupTranslation, storeTranslation } from "./cache";
import { recordTranslationAttempt } from "./debugLog";
import { withIcLlmSlot } from "@/lib/ic/icLlmConcurrency";
import {
  isIcLlmCircuitOpen,
  recordIcLlmSuccess,
  recordIcLlmFailure,
} from "@/lib/ic/icLlmCircuitBreaker";
import { getOllamaConfig, isOllamaEnabled } from "@/lib/ollama/storage";
import { isWebLLMEnabled } from "@/lib/webllm/storage";
import { isWebLLMLoaded } from "@/lib/webllm/engine";
import { isMediaPipeEnabled } from "@/lib/mediapipe/storage";
import { isMediaPipeLoaded } from "@/lib/mediapipe/engine";
import { getUserApiKey } from "@/lib/apiKey/storage";
import { withTimeout } from "@/lib/utils/timeout";
import { errMsg } from "@/lib/utils/errors";

// iOS Safari throws `TypeError: Load failed` from `fetch()` during app
// state transitions (wifi → cellular, background → foreground, Service
// Worker intercept races). Chrome uses `Failed to fetch`, Firefox uses
// `NetworkError when attempting to fetch resource`. All three are
// transient and recover on a single 500ms retry. AbortError and HTTP
// status errors are NOT retried — the former was self-inflicted, the
// latter is a deterministic server response.
const TRANSIENT_FETCH_ERROR_RE = /Load failed|Failed to fetch|NetworkError|network request failed/i;

// Failure reasons that are REAL infrastructure problems (vs canister
// application-level errors like "IC LLM translation failed"). When a
// cascade-exhausted failure set matches only this pattern we throw a
// user-visible notification; otherwise we silent-skip since retrying
// the same canister with the same content won't change the outcome.
const INFRA_ERROR_RE = /HTTP \d+|aborted|Load failed|Failed to fetch|NetworkError|network request failed|timeout|ECONNREFUSED/i;

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

// 25s budget: warm Claude calls return in 3-6s, the slowest observed
// cross-language pair (Chinese → Japanese) is ~9s, and Vercel cold
// starts add another 5-10s. Claude is the only path in the BYOK flow
// so there is no fallback to move on to — tight timeouts would just
// strand slow-but-valid responses.
async function callClaudeOnce(prompt: string, apiKey?: string | null): Promise<string> {
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
    console.debug("[translate] claude transient fetch error, retrying once after 500ms:", errMsg(err));
    await new Promise(resolve => setTimeout(resolve, 500));
    return callClaudeOnce(prompt, apiKey);
  }
}

// The DFINITY LLM canister is a free shared service backed by AI
// workers polling a queue; under load it returns
// `#err("IC LLM translation failed")`. Transport-level outcomes feed
// the circuit breaker so the cascade skips ic-llm once it enters a
// failing streak. A successful raw response resets the breaker even
// if the output later fails our validator — the canister was healthy,
// the content was the problem.
async function callIC(actor: _SERVICE, prompt: string): Promise<string> {
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

// The explicit `backend: "ic"` path enables `withRetry` because the
// user manually picked IC and has no fallback — they want it to try
// hard. The auto cascade path does NOT retry (the cascade itself is
// the retry mechanism).
async function translateWithIC(
  prompt: string,
  actorRef: React.MutableRefObject<_SERVICE | null>,
  withRetry = false,
): Promise<string> {
  const actor = actorRef.current;
  if (!actor) throw new Error("IC actor not available");
  if (!withRetry) return callIC(actor, prompt);

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

type BackendOutcome =
  | { kind: "ok"; parsed: { text: string; reason?: string } }
  | { kind: "skip" }
  | { kind: "failed"; reason: string };

// Validator rejections that are definitive verdicts "this content is
// not translatable" — promoted to skip instead of falling through so
// the 60s retry loop doesn't burn API cycles on doomed items:
//
//   - BYOK Claude returning no-kana for a ja target (URL / code /
//     already-Japanese-but-unrecognised)
//   - Any backend echoing the input verbatim (same signal as
//     ALREADY_IN_TARGET in a different shape)
function isDefinitiveUntranslatable(
  attemptName: string,
  reason: string,
  targetLanguage: TranslationLanguage,
): boolean {
  if (/identical to input/.test(reason)) return true;
  if (attemptName === "claude-byok" && targetLanguage === "ja" && /no kana/.test(reason)) return true;
  return false;
}

function makeSkip(reason: TranslationSkip["reason"], attempted: number): TranslationSkip {
  return { status: "skip", reason, attempted };
}

/** Whether an identical echo can plausibly mean "the input was already in the
 *  target language". Only ja has a cheap reliable signal (kana); for every
 *  other target an echo is a failed sample, not an answer about the input. */
function echoLooksAlreadyInTarget(originalText: string, targetLanguage: TranslationLanguage): boolean {
  return targetLanguage === "ja" && containsKana(originalText);
}

function definitiveSkipReason(
  attemptName: string,
  reason: string,
  targetLanguage: TranslationLanguage,
  originalText: string,
): TranslationSkip["reason"] | null {
  if (/identical to input/.test(reason)) {
    // An echo is definitive either way (re-sampling a paraphrase of it helps
    // nobody), but it only means "already in target" when the INPUT looks like
    // the target language — an English echo on an en→fr request is a failure.
    return echoLooksAlreadyInTarget(originalText, targetLanguage)
      ? "already-in-target"
      : "all-backends-failed";
  }
  if (isDefinitiveUntranslatable(attemptName, reason, targetLanguage)) return "all-backends-failed";
  return null;
}

export async function translateContent(opts: TranslateOptions): Promise<TranslationResult | TranslationSkip> {
  return Sentry.startSpan(
    {
      name: "translate.content",
      op: "translate",
      attributes: {
        "translate.backend": opts.backend,
        "translate.target": opts.targetLanguage,
      },
    },
    // Pass the span through so annotations go on THIS specific span
    // (span.setAttribute) rather than on the forked scope (Sentry.setTag).
    // Under concurrent browser-side translations, scope-based tagging races
    // between callbacks; span-direct annotation is race-free because each
    // call writes to its own span object.
    async (span) => translateContentInner(opts, span),
  );
}

async function translateContentInner(
  opts: TranslateOptions,
  span: Span,
): Promise<TranslationResult | TranslationSkip> {
  const { text, reason, targetLanguage, backend, actorRef, isAuthenticated } = opts;

  const cached = await lookupTranslation(text, targetLanguage);
  if (cached) {
    span.setAttribute("translate.result", "cache-hit");
    return cached;
  }

  const prompt = buildTranslationPrompt(text, targetLanguage, reason);

  // Parse + validate a raw backend response. Transport errors are
  // NOT caught here — they bubble to the cascade loop.
  const evaluateRaw = (raw: string): BackendOutcome => {
    if (!raw) return { kind: "failed", reason: "empty response" };
    const parsed = parseTranslationResponse(raw, targetLanguage);
    if (!parsed) return { kind: "skip" };
    const validation = validateTranslation(parsed.text, targetLanguage, text);
    if (!validation.valid) return { kind: "failed", reason: validation.reason! };
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
    span.setAttribute("translate.result", "ok");
    span.setAttribute("translate.backend", usedBackend);
    return result;
  };

  const explicitFail = (label: string, reason: string): string =>
    `${label} returned an unusable response (${reason}). Try switching to Auto in Settings → Translation Engine.`;

  // — Explicit backend selection —
  if (backend === "local") {
    const outcome = evaluateRaw(await translateWithOllama(prompt));
    if (outcome.kind === "skip") return makeSkip("already-in-target", 1);
    if (outcome.kind === "failed") throw new Error(explicitFail("Ollama", outcome.reason));
    return finalize(outcome.parsed, "ollama");
  }
  if (backend === "browser") {
    const useMediaPipe = isMediaPipeEnabled();
    const call = useMediaPipe ? translateWithMediaPipe : translateWithWebLLM;
    const label = useMediaPipe ? "MediaPipe" : "WebLLM";
    const engineName = useMediaPipe ? "mediapipe" : "webllm";
    const outcome = evaluateRaw(await call(prompt));
    if (outcome.kind === "skip") return makeSkip("already-in-target", 1);
    if (outcome.kind === "failed") throw new Error(explicitFail(label, outcome.reason));
    return finalize(outcome.parsed, engineName);
  }
  if (backend === "cloud") {
    // Cloud requires BYOK — the operator's server Anthropic key is
    // never used for translation (protected client-side here and at
    // the /api/translate boundary).
    const key = getUserApiKey();
    if (!key) {
      throw new TranslationBackendUnavailableError(
        "cloud",
        "Claude (Cloud) requires an Anthropic API key. Add one in Settings → API Key (BYOK), or pick IC LLM / Browser / Local in Translation Engine.",
      );
    }
    const outcome = evaluateRaw(await translateWithClaude(prompt, key));
    if (outcome.kind === "skip") return makeSkip("already-in-target", 1);
    if (outcome.kind === "failed") throw new Error(explicitFail("Claude (BYOK)", outcome.reason));
    return finalize(outcome.parsed, "claude-byok");
  }
  if (backend === "ic") {
    if (!actorRef || !isAuthenticated) {
      throw new TranslationBackendUnavailableError("ic", "IC requires authentication");
    }
    if (!actorRef.current) {
      throw new TranslationBackendUnavailableError("ic", "IC actor not available");
    }
    // Explicit IC mode enables the 1-second retry on transient
    // canister failures — the user picked IC knowing there's no
    // fallback and wants it to try hard before surfacing an error.
    const outcome = evaluateRaw(await translateWithIC(prompt, actorRef, true));
    if (outcome.kind === "skip") return makeSkip("already-in-target", 1);
    if (outcome.kind === "failed") {
      // Definitive classifications are ANSWERS, not noise (same guard as the
      // auto cascade): an echo of already-target input must skip, not be
      // re-sampled into a cached paraphrase.
      const definitive = definitiveSkipReason("ic-llm", outcome.reason, targetLanguage, text);
      if (definitive === "already-in-target") return makeSkip("already-in-target", 1);
      if (definitive) throw new Error(explicitFail("IC LLM", outcome.reason));
      // Non-definitive validator rejections are stochastic Llama noise; one
      // re-sample converts most.
      const retryOutcome = evaluateRaw(await translateWithIC(prompt, actorRef, true));
      if (retryOutcome.kind === "skip") return makeSkip("already-in-target", 2);
      if (retryOutcome.kind === "failed") {
        if (definitiveSkipReason("ic-llm", retryOutcome.reason, targetLanguage, text) === "already-in-target") {
          return makeSkip("already-in-target", 2);
        }
        throw new Error(explicitFail("IC LLM", `${retryOutcome.reason} (retried once)`));
      }
      return finalize(retryOutcome.parsed, "ic-llm");
    }
    return finalize(outcome.parsed, "ic-llm");
  }

  // — Auto cascade —
  //
  // Order: Ollama → (MediaPipe | WebLLM) → Claude BYOK → IC LLM.
  // claude-server is intentionally absent — operator cost protection,
  // enforced both here and at the /api/translate boundary. IC LLM sits
  // at the back as the free authenticated fallback; its ~42%
  // real-world success rate is fine because failures cascade-exhaust
  // into the silent-skip path below.
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
  if (actorRef?.current && isAuthenticated && !isIcLlmCircuitOpen()) {
    // No outer timeout here — callIC already bounds the actual canister call
    // (30s, started AFTER the concurrency slot is acquired). An outer budget
    // used to be 8s and INCLUDED the slot-queue wait: with the auto path
    // running up to 4 items against MAX_CONCURRENT_IC_LLM=2 slots, queued
    // items burned most of their budget waiting and timed out systematically
    // (field-observed 8013ms transport-errors; ~half the feed failing).
    // Queue wait is bounded: slots release in `finally` and each occupant is
    // capped by the inner 30s.
    attempts.push({ name: "ic-llm", fn: () => translateWithIC(prompt, actorRef, false) });
  }

  const itemHint = text.slice(0, 60);

  // Empty cascade: no configured backend (anonymous + no local + no
  // BYOK, or authenticated but breaker open). Silent skip — the
  // actor-ready hook in useTranslation will clear the skip set when
  // the IC actor becomes available, so items stranded at cold start
  // retry once ic-llm enters the cascade.
  if (attempts.length === 0) {
    span.setAttribute("translate.result", "empty-cascade");
    recordTranslationAttempt({
      itemHint, targetLanguage, backend: "auto",
      outcome: "skip", reason: "no configured translation backend",
      elapsedMs: 0,
    });
    return makeSkip("no-backend", 0);
  }

  const failures: Array<{ name: string; reason: string }> = [];
  let attempted = 0;

  for (const attempt of attempts) {
    const startedAt = Date.now();
    let raw: string;
    attempted++;
    try {
      raw = await attempt.fn();
    } catch (err) {
      const reason = errMsg(err);
      console.warn(`[translate] ${attempt.name} transport error:`, reason);
      failures.push({ name: attempt.name, reason });
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "transport-error", reason, elapsedMs: Date.now() - startedAt,
      });
      continue;
    }
    let outcome = evaluateRaw(raw);
    // Stochastic validator rejections (Llama runaway/noise, ~12.5% of ic-llm
    // samples) usually recover on ONE re-sample. Fires ONLY on app-level
    // rejections — a transport failure throws above and stays with the circuit
    // breaker + 60s-retry machinery (re-sampling during an outage would double
    // breaker hits, and an out-of-band retry succeeding could close a breaker
    // that just opened). Breaker re-checked here: a concurrent item may have
    // opened it since this cascade was built.
    if (
      outcome.kind === "failed" &&
      attempt.name === "ic-llm" &&
      !isIcLlmCircuitOpen() &&
      // Definitive classifications (echo of already-target input, untranslatable)
      // are ANSWERS, not noise — re-sampling them could replace a correct
      // already-in-target skip with a cached paraphrase of the original.
      definitiveSkipReason(attempt.name, outcome.reason, targetLanguage, text) === null
    ) {
      console.warn("[translate] ic-llm rejected, re-sampling once:", outcome.reason);
      // Record the validator failure in `failures` BEFORE re-sampling: if the
      // re-sample then dies on transport, the cascade must classify as MIXED
      // validator+transport (silent skip, matching pre-re-sample semantics) —
      // not as infra-only, which would throw/notify/60s-retry an item whose
      // first sample was already rejected on content grounds.
      failures.push({ name: attempt.name, reason: outcome.reason });
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "failed", reason: `${outcome.reason} (re-sampling)`, elapsedMs: Date.now() - startedAt,
      });
      attempted++;
      try {
        outcome = evaluateRaw(await attempt.fn());
      } catch (err) {
        const reason = errMsg(err);
        failures.push({ name: attempt.name, reason });
        recordTranslationAttempt({
          itemHint, targetLanguage, backend: attempt.name,
          outcome: "transport-error", reason, elapsedMs: Date.now() - startedAt,
        });
        continue;
      }
    }
    const elapsedMs = Date.now() - startedAt;
    if (outcome.kind === "ok") {
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "ok", reason: "", elapsedMs,
      });
      return finalize(outcome.parsed, attempt.name);
    }
    if (outcome.kind === "skip") {
      // ALREADY_IN_TARGET is a definitive answer — no later backend
      // can disagree, so short-circuit.
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "skip", reason: "ALREADY_IN_TARGET", elapsedMs,
      });
      return makeSkip("already-in-target", attempted);
    }
    const skipReason = definitiveSkipReason(attempt.name, outcome.reason, targetLanguage, text);
    if (skipReason) {
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "skip", reason: `untranslatable: ${outcome.reason}`, elapsedMs,
      });
      return makeSkip(skipReason, attempted);
    }
    // Soft validator failure — log, record, try the next backend.
    console.warn(`[translate] ${attempt.name} rejected:`, outcome.reason);
    failures.push({ name: attempt.name, reason: outcome.reason });
    recordTranslationAttempt({
      itemHint, targetLanguage, backend: attempt.name,
      outcome: "failed", reason: outcome.reason, elapsedMs,
    });
  }

  // Cascade exhausted. Throw a user-visible notification only when
  // every failure looks like real infrastructure trouble (HTTP error,
  // network failure, timeout, abort). Canister application-level
  // rejections ("IC LLM translation failed") and validator rejections
  // silent-skip — retrying the same input against the same backends
  // in 60s won't change the outcome.
  const summary = failures.map(f => `${f.name}: ${f.reason}`).join(" | ");
  if (failures.length > 0 && failures.every(f => INFRA_ERROR_RE.test(f.reason))) {
    span.setAttribute("translate.result", "infra-error");
    const error = new Error(
      failures.length === 1
        ? `Translation backend failed — ${summary}`
        : `All ${failures.length} translation backends failed — ${summary}`,
    );
    // captureException carries its own tags + context scoped to this
    // specific event — no interaction with span attributes or current
    // scope, so safe to use alongside span.setAttribute.
    Sentry.captureException(error, {
      tags: {
        "translate.result": "infra-error",
        "translate.target": targetLanguage,
      },
      contexts: { translate: { failures, attempts: attempts.length } },
    });
    throw error;
  }
  span.setAttribute("translate.result", "cascade-skip");
  recordTranslationAttempt({
    itemHint, targetLanguage, backend: "auto",
    outcome: "skip",
    reason: `cascade exhausted (validator): ${summary}`,
    elapsedMs: 0,
  });
  return makeSkip("all-backends-failed", attempted);
}
