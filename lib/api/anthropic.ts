// Per-route differences (timeout, max_tokens, error mapping) live at the call site.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface CallAnthropicOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  timeoutMs: number;
}

interface AnthropicResponse {
  ok: boolean;
  status: number;
  // First text block, or "" when missing.
  text: string;
  // Parsed JSON when ok, raw string when not.
  raw: unknown;
}

// Network failures (timeout/abort/refused) propagate as throws; non-2xx returns ok:false.
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
