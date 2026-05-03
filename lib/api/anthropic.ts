/**
 * Shared Anthropic Claude API caller.
 *
 * The wire contract is identical across /api/analyze, /api/briefing/digest,
 * and /api/translate: same URL, same auth header, same anthropic-version.
 * Per-route differences (timeout, max_tokens, error mapping) are kept at
 * the call site so each route preserves its existing failure semantics.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Default Anthropic model used by all server-side scoring/translation/digest
 * routes. Bumping the model is a single-line change here — search call sites
 * before doing it to confirm none want to pin a specific version.
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-20250514";

interface CallAnthropicOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Per-route timeout in milliseconds (analyze 15s, digest 15s, translate 25s). */
  timeoutMs: number;
}

interface AnthropicResponse {
  ok: boolean;
  status: number;
  /** First text block of the assistant response, or "" when missing. */
  text: string;
  /** Raw response body (already-parsed JSON when ok, raw string when not). Useful for caller-side logging. */
  raw: unknown;
}

/**
 * Calls Anthropic with the configured payload and returns a normalized result.
 * Caller decides how to map non-ok responses (heuristic fallback / 502 passthrough / etc.).
 * Network-level failures (timeout, abort, connection refused) propagate as throws.
 */
export async function callAnthropic(opts: CallAnthropicOptions): Promise<AnthropicResponse> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: opts.messages,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, status: res.status, text: "", raw: errText };
  }

  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";
  return { ok: true, status: res.status, text, raw: data };
}
