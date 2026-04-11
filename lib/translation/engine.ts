import type { TranslationLanguage, TranslationBackend, TranslationResult } from "./types";
import type { _SERVICE } from "@/lib/ic/declarations";
import { buildTranslationPrompt, parseTranslationResponse } from "./prompt";
import { validateTranslation } from "./validate";
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

// Used at the end of the auto cascade to decide whether to throw a
// user-visible error (transport problem, retry after 60s) or silently
// skip (validator rejection, retry is pointless).
const TRANSPORT_ERROR_RE = /HTTP \d+|aborted|Load failed|Failed to fetch|NetworkError|network request failed|timeout|ECONNREFUSED/i;

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

// Outcome of parsing + validating a single backend response. The
// explicit-backend path and the auto-cascade loop both dispatch on
// this so neither has to re-parse the raw response.
type BackendOutcome =
  | { kind: "ok"; parsed: { text: string; reason?: string } }
  | { kind: "skip" }
  | { kind: "failed"; reason: string };

/**
 * Skip promotion predicate: when a validator rejection is a definitive
 * "this content is not translatable" verdict, we promote the failure
 * to a skip instead of falling through and retrying. Two cases:
 *
 *   1. BYOK Claude returned text with no Japanese kana for a ja
 *      target — Claude considered the input untranslatable (URL,
 *      code, already-Japanese-but-unrecognised).
 *   2. Any backend echoed the input verbatim — same signal as
 *      ALREADY_IN_TARGET in a different shape.
 *
 * Without these promotions the item would bounce between the failed
 * and retry sets on the 60-second interval forever, burning API
 * cycles on content the model has already said it cannot translate.
 */
function isDefinitiveUntranslatable(
  attemptName: string,
  reason: string,
  targetLanguage: TranslationLanguage,
): boolean {
  if (/identical to input/.test(reason)) return true;
  if (attemptName === "claude-byok" && targetLanguage === "ja" && /no kana/.test(reason)) return true;
  return false;
}

export async function translateContent(opts: TranslateOptions): Promise<TranslationResult | "skip"> {
  const { text, reason, targetLanguage, backend, actorRef, isAuthenticated } = opts;

  const cached = await lookupTranslation(text, targetLanguage);
  if (cached) return cached;

  const prompt = buildTranslationPrompt(text, targetLanguage, reason);

  // Parse + validate a raw backend response. Empty / unparseable /
  // validator-rejected outputs are reported as `failed` so callers
  // can decide whether to fall through (cascade) or surface the
  // failure (explicit backend). Transport errors are NOT caught here
  // — they bubble up to the caller.
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
    return result;
  };

  // Surface a validator-rejected outcome from explicit-backend mode as
  // a thrown Error with an actionable message. Returning a generic
  // "failed" was misleading because the notification then claimed "no
  // backend available" when only the user's single chosen backend was
  // tried.
  const explicitFail = (label: string, reason: string): string =>
    `${label} returned an unusable response (${reason}). Try switching to Auto in Settings → Translation Engine.`;

  // — Explicit backend selection —
  if (backend === "local") {
    const outcome = evaluateRaw(await translateWithOllama(prompt));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFail("Ollama", outcome.reason));
    return finalize(outcome.parsed, "ollama");
  }
  if (backend === "browser") {
    const useMediaPipe = isMediaPipeEnabled();
    const call = useMediaPipe ? translateWithMediaPipe : translateWithWebLLM;
    const label = useMediaPipe ? "MediaPipe" : "WebLLM";
    const engineName = useMediaPipe ? "mediapipe" : "webllm";
    const outcome = evaluateRaw(await call(prompt));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFail(label, outcome.reason));
    return finalize(outcome.parsed, engineName);
  }
  if (backend === "cloud") {
    // Cloud backend requires a user-provided Anthropic API key. Before
    // hotfix 17 this silently fell back to the operator-hosted server
    // key when BYOK was missing, which meant every user without a key
    // burned the operator's Anthropic budget. Now the cost path is
    // opt-in at account-setup level, not at runtime.
    const key = getUserApiKey();
    if (!key) {
      throw new Error(
        "Claude (Cloud) requires an Anthropic API key. Add one in Settings → API Key (BYOK), or pick IC LLM / Browser / Local in Translation Engine.",
      );
    }
    const outcome = evaluateRaw(await translateWithClaude(prompt, key));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFail("Claude (BYOK)", outcome.reason));
    return finalize(outcome.parsed, "claude-byok");
  }
  if (backend === "ic") {
    if (!actorRef || !isAuthenticated) throw new Error("IC requires authentication");
    // Explicit IC mode enables the 1-second retry on transient
    // canister failures — the user picked IC knowing there's no
    // fallback and wants it to try hard before surfacing an error.
    const outcome = evaluateRaw(await translateWithIC(prompt, actorRef, true));
    if (outcome.kind === "skip") return "skip";
    if (outcome.kind === "failed") throw new Error(explicitFail("IC LLM", outcome.reason));
    return finalize(outcome.parsed, "ic-llm");
  }

  // — Auto cascade —
  //
  // Composition (in order):
  //   1. Ollama                  (local, user-configured)
  //   2. MediaPipe | WebLLM      (browser WebGPU, mutually exclusive)
  //   3. Claude BYOK             (user-provided API key)
  //   4. IC LLM                  (free, authenticated users only)
  //
  // claude-server is NOT in the cascade. The operator-hosted Anthropic
  // route is reachable only via explicit `backend: "cloud"` with a
  // BYOK key, so anonymous / non-BYOK users never burn the operator's
  // budget unintentionally.
  //
  // IC LLM sits at the back as the free authenticated fallback — its
  // real-world success rate is ~42%, but the items it can't handle
  // simply cascade-exhaust into the silent-skip path below, which is
  // strictly better than showing a failure notification.
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
    // 8s budget: normal Llama 3.1 8B responses return in 2-5s. No
    // retry — on exhaustion the cascade silent-skips.
    attempts.push({ name: "ic-llm", fn: () => withTimeout(
      translateWithIC(prompt, actorRef, false), 8_000, "IC LLM auto-cascade timeout",
    ) });
  }

  const itemHint = text.slice(0, 60);

  // Empty cascade: user has no configured backend (anonymous + no
  // local + no BYOK, or authenticated but breaker open). Silent skip
  // — no error notification, no retry, the item renders in its
  // original language. The actor-ready hook clears the skip set when
  // the IC actor becomes available, so items stranded at cold start
  // get a second chance once ic-llm enters the cascade.
  if (attempts.length === 0) {
    recordTranslationAttempt({
      itemHint, targetLanguage, backend: "auto",
      outcome: "skip", reason: "no configured translation backend",
      elapsedMs: 0,
    });
    return "skip";
  }

  const failures: Array<{ name: string; reason: string }> = [];
  let transportFailureCount = 0;

  for (const attempt of attempts) {
    const startedAt = Date.now();
    let raw: string;
    try {
      raw = await attempt.fn();
    } catch (err) {
      const reason = errMsg(err);
      console.warn(`[translate] ${attempt.name} transport error:`, reason);
      failures.push({ name: attempt.name, reason });
      transportFailureCount += 1;
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "transport-error", reason, elapsedMs: Date.now() - startedAt,
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
      // ALREADY_IN_TARGET is a definitive answer — no later backend
      // can disagree, so short-circuit.
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "skip", reason: "ALREADY_IN_TARGET", elapsedMs,
      });
      return "skip";
    }
    if (isDefinitiveUntranslatable(attempt.name, outcome.reason, targetLanguage)) {
      recordTranslationAttempt({
        itemHint, targetLanguage, backend: attempt.name,
        outcome: "skip", reason: `untranslatable: ${outcome.reason}`, elapsedMs,
      });
      return "skip";
    }
    // Soft validator failure — log, record, try the next backend.
    console.warn(`[translate] ${attempt.name} rejected:`, outcome.reason);
    failures.push({ name: attempt.name, reason: outcome.reason });
    recordTranslationAttempt({
      itemHint, targetLanguage, backend: attempt.name,
      outcome: "failed", reason: outcome.reason, elapsedMs,
    });
  }

  // Cascade exhausted. If every attempt was a transport-level
  // failure, throw so the user sees a "Translation failed" notification
  // (and the 60s retry loop will try again — infra problems are often
  // transient). If any attempt failed at the validator, silent-skip
  // — content-level problems won't be fixed by retrying the same
  // input against the same backends. The breaker-gate + transport
  // regex must match the set of failure-reason shapes we actually
  // emit above.
  const summary = failures.map(f => `${f.name}: ${f.reason}`).join(" | ");
  if (transportFailureCount === failures.length && failures.every(f => TRANSPORT_ERROR_RE.test(f.reason))) {
    throw new Error(
      failures.length === 1
        ? `Translation backend failed — ${summary}`
        : `All ${failures.length} translation backends failed — ${summary}`,
    );
  }
  recordTranslationAttempt({
    itemHint, targetLanguage, backend: "auto",
    outcome: "skip",
    reason: `cascade exhausted (validator): ${summary}`,
    elapsedMs: 0,
  });
  return "skip";
}
