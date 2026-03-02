import type { ScoreParseResult } from "@/lib/scoring/types";
import type { OllamaStatus } from "./types";
import { getOllamaConfig } from "./storage";
import { buildScoringPrompt } from "@/lib/scoring/prompt";
import { parseScoreResponse } from "@/lib/scoring/parseResponse";
import { errMsg } from "@/lib/utils/errors";
import { createStatusEmitter } from "@/lib/utils/statusEmitter";

const { emit: emitStatus, onStatusChange } = createStatusEmitter<OllamaStatus>({
  connected: false,
  loading: false,
  models: [],
});

export { onStatusChange };

export async function testOllamaConnection(
  endpoint: string,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const base = endpoint.replace(/\/+$/, "");

  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json();
      const models = Array.isArray(data.models)
        ? data.models.map((m: { name?: string }) => m.name || "").filter(Boolean)
        : [];
      return { ok: true, models };
    }
  } catch (err) {
    console.debug("[ollama] Native /api/tags failed, trying OpenAI-compatible endpoint:", errMsg(err));
  }

  try {
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json();
      const models = Array.isArray(data.data)
        ? data.data.map((m: { id?: string }) => m.id || "").filter(Boolean)
        : [];
      return { ok: true, models };
    }
    return { ok: false, models: [], error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, models: [], error: errMsg(err) };
  }
}

export async function scoreWithOllama(
  text: string,
  userTopics?: string[],
): Promise<ScoreParseResult> {
  const config = getOllamaConfig();
  const base = config.endpoint.replace(/\/+$/, "");

  emitStatus({ loading: true, error: undefined });

  try {
    const prompt = buildScoringPrompt(text, userTopics);

    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const result = parseScoreResponse(raw);

    if (!result) {
      throw new Error("Failed to parse Ollama response as score JSON");
    }

    emitStatus({ connected: true, loading: false });
    return result;
  } catch (err) {
    emitStatus({ loading: false, error: errMsg(err) });
    throw err;
  }
}
